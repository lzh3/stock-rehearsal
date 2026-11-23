import { useEffect, useMemo, useState } from 'react';
import type { AiConfig } from '../ai/types';
import { AI_DEFAULTS, AI_PRESETS } from '../ai/types';
import { runAnalysis } from '../ai/analyze';
import type { Bar, Board, ForecastBar, Stock } from '../core/types';
import { fmtPct, fmtPrice } from '../core/format';
import { computeStats, fmtCap } from '../ai/prompt';

interface Props {
  stock: Stock;
  bars: Bar[];
  forecasts: ForecastBar[];
  board: Board;
  config: AiConfig | null;
  onSaveConfig: (config: AiConfig) => Promise<void>;
  onSaveFundamentals: (text: string) => Promise<void>;
  onFetchProfile: () => Promise<void>;
}

interface Insight {
  headline?: string;
  stance?: string;
  confidence?: string;
  points?: string[];
  risks?: string[];
  horizon?: string;
  source?: string;
  model?: string;
}

const STANCE_CLASS: Record<string, string> = {
  偏多: 'ai-strict-up',
  偏空: 'ai-strict-down',
  中性: 'ai-strict-neutral',
};

export function AiAnalysis({
  stock,
  bars,
  forecasts,
  board,
  config,
  onSaveConfig,
  onSaveFundamentals,
  onFetchProfile,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [supplement, setSupplement] = useState(stock.fundamentals ?? '');
  const [draft, setDraft] = useState<AiConfig>(
    config ?? { stockId: '__global__', ...AI_DEFAULTS, updatedAt: 0 },
  );

  useEffect(() => {
    if (config) setDraft(config);
  }, [config]);

  useEffect(() => {
    setSupplement(stock.fundamentals ?? '');
  }, [stock.id, stock.fundamentals]);

  const stats = useMemo(() => computeStats(bars), [bars]);
  const profile = stock.profile;
  const lastBar = bars.length ? bars[bars.length - 1] : null;
  const hasKey = Boolean(draft.apiKey.trim());

  const statText: { label: string; value: string }[] = stats
    ? [
        { label: '收盘', value: fmtPrice(stats.lastClose) },
        { label: '近5日', value: fmtPct(stats.chg5) },
        { label: '近20日', value: fmtPct(stats.chg20) },
        { label: '站上MA20', value: `${stats.aboveMa20Days}天` },
      ]
    : [];

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (supplement !== (stock.fundamentals ?? '')) await onSaveFundamentals(supplement);
      const result = await runAnalysis(draft, { stock: { ...stock, fundamentals: supplement }, bars, forecasts });
      setInsight(result.insight as Insight);
      setError(result.error ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const refreshProfile = async () => {
    setProfileBusy(true);
    setError(null);
    try {
      await onFetchProfile();
    } catch (e) {
      setError(`基本面快照获取失败：${(e as Error).message}`);
    } finally {
      setProfileBusy(false);
    }
  };

  const applyPreset = (id: string) => {
    const preset = AI_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setDraft((d) => ({ ...d, baseUrl: preset.baseUrl, model: preset.model }));
  };

  return (
    <div className="ai-block">
      <div className="ai-head">
        <span className="ai-title">
          AI 看法
          <em>{hasKey ? draft.model : '未填 Key'}</em>
        </span>
        <div className="ai-head-actions">
          <button className="btn ghost tiny" type="button" onClick={() => setOpen((v) => !v)}>
            {open ? '收起设置' : '设置'}
          </button>
          <button className="btn primary tiny" type="button" onClick={() => void run()} disabled={busy}>
            {busy ? '分析中…' : insight ? '重新分析' : '生成 AI 分析'}
          </button>
        </div>
      </div>

      {open && (
        <div className="ai-settings">
          <div className="field-row">
            <div className="field">
              <label className="field-label">服务商预设</label>
              <select
                className="select"
                defaultValue=""
                onChange={(e) => {
                  applyPreset(e.target.value);
                  e.currentTarget.value = '';
                }}
              >
                <option value="">选择预设填充地址/模型…</option>
                {AI_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">模型</label>
              <input
                className="input mono"
                value={draft.model}
                onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                placeholder="deepseek-chat"
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label">接口地址（OpenAI 兼容 /chat/completions）</label>
            <input
              className="input mono"
              value={draft.baseUrl}
              onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
              placeholder="https://api.deepseek.com/v1"
            />
          </div>

          <div className="field">
            <label className="field-label">API Key（留空则只显示本地统计，不调用大模型）</label>
            <input
              className="input mono"
              type="password"
              value={draft.apiKey}
              onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
              placeholder="sk-…（仅保存在本机 IndexedDB）"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="field">
            <label className="field-label">补充信息（可选，不填也能分析）</label>
            <textarea
              className="textarea"
              style={{ minHeight: 76 }}
              value={supplement}
              onChange={(e) => setSupplement(e.target.value)}
              onBlur={() => void onSaveFundamentals(supplement)}
              placeholder="有特别想强调的点可以写在这里，例如：公司刚公告定增、行业政策有变化…"
            />
          </div>

          <div className="btn-row">
            <button className="btn" type="button" onClick={() => void onSaveConfig(draft).then(() => setError(null))} disabled={busy}>
              保存设置
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => setDraft({ stockId: '__global__', ...AI_DEFAULTS, updatedAt: 0 })}
            >
              恢复默认
            </button>
          </div>
        </div>
      )}

      <div className="ai-profile">
        <div className="ai-profile-head">
          <span className="muted">行情与估值快照</span>
          <button className="btn ghost tiny" type="button" onClick={() => void refreshProfile()} disabled={profileBusy}>
            {profileBusy ? '获取中…' : profile ? '刷新基本面' : '获取基本面'}
          </button>
        </div>
        {profile ? (
          <div className="ai-chips">
            <span className="ai-chip">
              <span className="muted">行业</span>
              <b>{profile.industry ?? '—'}</b>
            </span>
            <span className="ai-chip">
              <span className="muted">总市值</span>
              <b>{fmtCap(profile.totalCap)}</b>
            </span>
            <span className="ai-chip">
              <span className="muted">PE</span>
              <b>{profile.pe != null && profile.pe > 0 ? profile.pe.toFixed(1) : '—'}</b>
            </span>
            <span className="ai-chip">
              <span className="muted">PB</span>
              <b>{profile.pb != null && profile.pb > 0 ? profile.pb.toFixed(2) : '—'}</b>
            </span>
            <span className="ai-chip">
              <span className="muted">换手</span>
              <b>{profile.turnover != null ? `${profile.turnover.toFixed(2)}%` : '—'}</b>
            </span>
            {profile.industryPct != null && (
              <span className="ai-chip">
                <span className="muted">行业当日</span>
                <b className={profile.industryPct >= 0 ? 'up' : 'down'}>
                  {profile.industryPct >= 0 ? '+' : ''}
                  {profile.industryPct.toFixed(2)}%
                  {profile.industryRank ? ` · 第${profile.industryRank}` : ''}
                </b>
              </span>
            )}
          </div>
        ) : (
          <p className="hint ai-empty">
            点「获取基本面」会自动拉取市值、PE/PB、换手率、所属行业与当日板块强弱，AI 会据此判断，不需要你手填。
          </p>
        )}
        {statText.length > 0 && (
          <div className="ai-stats">
            {statText.map((s) => (
              <span key={s.label}>
                <span className="muted">{s.label}</span>
                <b>{s.value}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      {error && <p className="ai-error">{error}</p>}

      {insight && (
        <div className="ai-result">
          <div className="ai-verdict">
            <span className={`ai-stance ${STANCE_CLASS[insight.stance ?? '中性'] ?? 'ai-strict-neutral'}`}>
              {insight.stance ?? '中性'}
            </span>
            <b className="ai-headline">{insight.headline ?? '—'}</b>
            {insight.confidence && <span className="ai-meta">置信度 {insight.confidence}</span>}
            {insight.horizon && <span className="ai-meta">{insight.horizon}</span>}
          </div>
          <ul className="ai-points">
            {(insight.points ?? []).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          {(insight.risks ?? []).length > 0 && <p className="ai-risk">风险：{(insight.risks ?? []).join('；')}</p>}
          <p className="ai-disclaimer">
            {insight.source === 'llm' ? `由 ${insight.model ?? '大模型'} 生成` : '基于本地行情统计'}，仅供研究参考，不构成投资建议
            {lastBar ? ` · 基准 ${lastBar.date}` : ''} · {board === 'main' ? '主板' : board === 'gem' ? '创业板' : board === 'star' ? '科创板' : board === 'bse' ? '北交所' : 'ST'}
            {profile ? ' · 含行情估值快照' : ''}
          </p>
        </div>
      )}

      {!insight && !open && !profile && (
        <p className="hint ai-empty">
          点「获取基本面」自动拉取市值/估值/行业，再点「生成 AI 分析」，模型会结合自身对 A 股与行业的理解给出判断。
        </p>
      )}
    </div>
  );
}
