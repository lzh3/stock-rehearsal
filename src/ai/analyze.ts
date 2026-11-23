import type { AiConfig } from './types';
import type { Bar, ForecastBar, Stock } from '../core/types';
import { chatCompletions, extractJson } from './client';
import { buildPrompt, computeStats, fmtCap } from './prompt';

export type AnalysisMode = 'llm' | 'local-only';

export interface AnalysisResult {
  mode: AnalysisMode;
  insight: Record<string, unknown>;
  error?: string;
}

export async function runAnalysis(
  config: AiConfig,
  input: { stock: Stock; bars: Bar[]; forecasts: ForecastBar[] },
): Promise<AnalysisResult> {
  const prompt = buildPrompt({ stock: input.stock, bars: input.bars, forecasts: input.forecasts });
  const stats = computeStats(input.bars);

  // 没有 Key 时只做客观统计，不冒充大模型观点
  if (!config.apiKey.trim()) {
    return {
      mode: 'local-only',
      insight: localInsight(input.stock, input.forecasts, stats),
      error: '未填写 API Key，暂无 AI 判断；以下仅为本地行情统计。',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    const text = await chatCompletions(config, prompt, controller.signal);
    const json = extractJson(text);
    if (!json) throw new Error('模型返回内容无法解析为 JSON');
    return { mode: 'llm', insight: normalizeInsight(json, config.model) };
  } catch (e) {
    return {
      mode: 'local-only',
      insight: localInsight(input.stock, input.forecasts, stats),
      error: `大模型调用失败，已回退本地统计：${(e as Error).message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function localInsight(
  stock: Stock,
  forecasts: ForecastBar[],
  stats: ReturnType<typeof computeStats> | null,
): Record<string, unknown> {
  const profile = stock.profile;
  const points: string[] = [];
  const risks: string[] = [];

  if (!stats) {
    return {
      headline: '缺少 K 线数据',
      stance: '中性',
      confidence: '低',
      points: ['先导入或拉取历史行情再分析'],
      risks: ['无数据'],
      horizon: '未知',
      source: 'local-only',
    };
  }

  // ① 量价与位置
  const pos = stats.high60 > stats.low60 ? ((stats.lastClose - stats.low60) / (stats.high60 - stats.low60)) * 100 : null;
  if (pos != null) {
    points.push(
      `${pos >= 80 ? '处于60日区间上沿' : pos <= 20 ? '处于60日区间下沿' : '位于60日区间中部'}（${pos.toFixed(0)}%），MA20 ${
        stats.aboveMa20Days >= 10 ? '上方强势' : stats.aboveMa20Days > 0 ? '上方待确认' : '下方偏弱'
      }`
    );
  } else {
    points.push('区间数据不足，趋势暂无法判断');
  }

  // ② 估值与行业地位
  if (profile) {
    const val = profile.pe != null && profile.pe > 0 ? `PE ${profile.pe.toFixed(1)}倍` : 'PE 缺失或亏损';
    points.push(`${profile.industry ?? '行业未知'}，市值 ${fmtCap(profile.totalCap)}，${val}，换手 ${profile.turnover?.toFixed(2) ?? '--'}%`);
  } else {
    points.push('未拉取市值/估值数据，建议先点「刷新基本面」');
    risks.push('缺少估值与行业信息，判断依据不足');
  }

  // ③ 板块环境
  if (profile?.industryPct != null) {
    points.push(
      `行业当日 ${profile.industryPct > 0 ? '上涨' : '下跌'} ${profile.industryPct.toFixed(2)}%${
        profile.industryRank ? `，涨幅排名第 ${profile.industryRank}` : ''
      }`
    );
  } else {
    points.push(forecasts.length ? `已设 ${forecasts.length} 天预演，需结合板块确认` : '未设预演，按当前趋势观察');
  }

  const stance =
    stats.chg20 != null && stats.chg20 > 8 && stats.aboveMa20Days >= 5
      ? '偏多'
      : stats.chg20 != null && stats.chg20 < -5 && stats.aboveMa20Days < 5
      ? '偏空'
      : '中性';

  return {
    headline: stance === '偏多' ? '结构偏强但需量能确认' : stance === '偏空' ? '弱势格局未见扭转' : '区间震荡，等待方向',
    stance,
    confidence: '低',
    points,
    risks: risks.length ? risks : ['仅为统计摘要，非 AI 判断'],
    horizon: '1~5个交易日',
    source: 'local-only',
  };
}

function normalizeInsight(json: Record<string, unknown>, model: string): Record<string, unknown> {
  const str = (key: string, def: string): string => {
    const v = json[key];
    return typeof v === 'string' && v.trim() ? v.trim() : def;
  };
  const arr = (key: string, max = 3): string[] => {
    const v = json[key];
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, max);
  };

  const stance = str('stance', '中性');
  const confidence = str('confidence', '中');
  const points = arr('points');

  return {
    headline: str('headline', '暂无结论'),
    stance: ['偏多', '偏空', '中性'].includes(stance) ? stance : '中性',
    confidence: ['低', '中', '高'].includes(confidence) ? confidence : '中',
    points: points.length ? points : ['模型未给出要点'],
    risks: arr('risks', 2),
    horizon: str('horizon', '1~5个交易日'),
    model,
    source: 'llm',
  };
}
