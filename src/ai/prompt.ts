import type { Bar, SectorSnapshot, Stock } from '../core/types';
import { BOARDS } from '../core/limit';
import { fmtPrice, fmtPct } from '../core/format';

export interface MarketStats {
  lastDate: string;
  lastClose: number;
  avgVolume20: number;
  high60: number;
  low60: number;
  chg5: number | null;
  chg20: number | null;
  aboveMa20Days: number;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  lastChangePct: number | null;
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeStats(bars: Bar[]): MarketStats | null {
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const tail = <T,>(arr: T[], n: number) => arr.slice(Math.max(0, arr.length - n));

  const last5 = tail(bars, 6);
  const last20 = tail(bars, 21);
  const last60 = tail(bars, 60);

  const closes = bars.map((b) => b.close);
  const ma = (period: number): number | null => {
    if (closes.length < period) return null;
    return avg(closes.slice(-period));
  };
  const ma20 = ma(20);

  let aboveCount = 0;
  if (ma20 != null) {
    for (let i = bars.length - 1; i >= 0; i -= 1) {
      const window = closes.slice(Math.max(0, i - 19), i + 1);
      if (window.length < 20) break;
      if (bars[i].close >= avg(window)) aboveCount += 1;
      else break;
    }
  }

  return {
    lastDate: last.date,
    lastClose: last.close,
    avgVolume20: avg(last20.map((b) => b.volume)),
    high60: Math.max(...last60.map((b) => b.high)),
    low60: Math.min(...last60.map((b) => b.low)),
    chg5: last5.length > 1 ? ((last.close - last5[0].close) / last5[0].close) * 100 : null,
    chg20: last20.length > 1 ? ((last.close - last20[0].close) / last20[0].close) * 100 : null,
    aboveMa20Days: aboveCount,
    ma5: ma(5),
    ma10: ma(10),
    ma20,
    lastChangePct: prev ? ((last.close - prev.close) / prev.close) * 100 : null,
  };
}

/** 市值（元）→ 亿 */
export function fmtCap(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '未知';
  const yi = value / 1e8;
  if (yi >= 1000) return `${(yi / 1000).toFixed(2)} 千亿`;
  return `${yi.toFixed(yi >= 100 ? 0 : yi >= 10 ? 1 : 2)} 亿`;
}

function fmtMultiple(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '未知（亏损或缺失）';
  return `${value.toFixed(1)} 倍`;
}

function fmtPctOrUnknown(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '未知';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function sectorBlock(sector?: SectorSnapshot): string {
  if (!sector) return '  （板块数据缺失）';
  const up = sector.up.map((r) => `${r.name}${fmtPctOrUnknown(r.pct)}`).join('、');
  const down = sector.down.map((r) => `${r.name}${fmtPctOrUnknown(r.pct)}`).join('、');
  return `  领涨行业：${up || '无'}\n  领跌行业：${down || '无'}\n  行业板块总数：${sector.total}`;
}

export interface AnalysisInput {
  stock: Stock;
  bars: Bar[];
  forecasts: Array<Bar & { note?: string; tags?: string[] }>;
}

export function buildPrompt({ stock, bars, forecasts }: AnalysisInput): string {
  const stats = computeStats(bars);
  const board = BOARDS[stock.board];
  const profile = stock.profile;
  const supplement = (stock.fundamentals ?? '').trim();

  const scenario = forecasts.length
    ? forecasts
        .map((f, i) => {
          const prevClose = i === 0 ? bars[bars.length - 1]?.close ?? f.open : forecasts[i - 1].close;
          const pct = ((f.close - prevClose) / prevClose) * 100;
          return `  D${i + 1} ${f.date}: 开 ${fmtPrice(f.open)} 高 ${fmtPrice(f.high)} 低 ${fmtPrice(
            f.low,
          )} 收 ${fmtPrice(f.close)} (${fmtPct(pct)})`;
        })
        .join('\n')
    : '  （尚未设定预演）';

  const recent = bars
    .slice(-12)
    .map((b) => `  ${b.date} 收 ${fmtPrice(b.close)} 量 ${Math.round(b.volume / 1e4)}万`)
    .join('\n');

  const profileBlock = profile
    ? `  最新价：${profile.price != null ? fmtPrice(profile.price) : '未知'}（当日 ${fmtPctOrUnknown(
        profile.changePct,
      )}）
  总市值：${fmtCap(profile.totalCap)}　流通市值：${fmtCap(profile.floatCap)}
  市盈率(动)：${fmtMultiple(profile.pe)}　市净率：${fmtMultiple(profile.pb)}
  换手率：${profile.turnover != null ? profile.turnover.toFixed(2) + '%' : '未知'}
  所属行业：${profile.industry ?? '未知'}${profile.region ? `　地区：${profile.region}` : ''}
  行业当日表现：${fmtPctOrUnknown(profile.industryPct)}${
        profile.industryRank ? `（全市场行业涨幅第 ${profile.industryRank} 名）` : ''
      }
  当日板块环境：
${sectorBlock(profile.sector)}`
    : '  （未获取，可先点击「刷新基本面」拉取市值/估值/行业数据）';

  return `你是一名有多年 A 股实战经验的研究员。请用你自身的行业认知、板块轮动经验与交易常识，结合下面的客观数据，对这只股票给出独立判断。不要只是复述数据。

【标的】
名称：${stock.name || profile?.name || '未知'}
代码：${stock.code || profile?.code || '未知'}
板块属性：${board.label}（涨跌停 ±${Math.round(board.rate * 100)}%）

【市场与估值快照（来自公开行情接口）】
${profileBlock}

【技术面（取自本地 K 线，前复权）】
${
  stats
    ? `  最新收盘：${fmtPrice(stats.lastClose)}（${stats.lastDate}，当日 ${fmtPct(stats.lastChangePct ?? 0)}）
  近5日 ${fmtPct(stats.chg5 ?? 0)}，近20日 ${fmtPct(stats.chg20 ?? 0)}
  60日区间：${fmtPrice(stats.low60)} ~ ${fmtPrice(stats.high60)}
  MA5 ${fmtPrice(stats.ma5)} / MA10 ${fmtPrice(stats.ma10)} / MA20 ${fmtPrice(stats.ma20)}
  连续站上 MA20：${stats.aboveMa20Days} 天　20日均量：${Math.round(stats.avgVolume20 / 1e4)} 万`
    : '  （无 K 线数据）'
}

【最近 12 个交易日】
${recent || '  （无）'}

【已设定的预演路径（假设情景，非预测）】
${scenario}

【用户补充信息（可能为空白，仅作参考，不要当成事实来源）】
${supplement || '（无）'}

【分析要求】
1. 你要主动判断，不要罗列数据：给出量价结构、位置（相对 60 日区间/均线）、估值与市值的匹配度、所属行业与当日板块强弱、以及该公司所在赛道的习性与常见炒作逻辑。数据缺失的部分，用你的行业常识推断方向，但要注明是推断。
2. 严禁编造具体财务数字（营收、净利、增速、订单等）。可以描述行业格局、商业模式、周期位置这类一般性认知。
3. 若预演路径与上述判断相矛盾（例如连续涨停后你判断风险偏高），必须直接指出来。
4. 只输出 JSON，不要 markdown 代码块、不要任何解释文字，结构固定为：
{"headline":"一句话结论(不超过30字)","stance":"偏多|偏空|中性","confidence":"低|中|高","points":["要点1(不超过30字)","要点2(不超过30字)","要点3(不超过30字)"],"risks":["主要风险(不超过30字)"],"horizon":"1~5个交易日"}
5. points 恰好 3 条，依次覆盖：① 量价与位置 ② 估值/市值与行业地位 ③ 板块环境与后续节奏。语言要像交易员说话，短、准、可用。
6. 不给目标价、不承诺收益、不写免责声明（页面已有）。`;
}
