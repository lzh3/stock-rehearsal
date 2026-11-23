import { useEffect, useState } from 'react';
import type { Stock } from '../core/types';
import { PROVIDER_ORDER, PROVIDERS, toSecid } from '../data';
import type { FetchResult } from '../data';
import { fmtPrice, fmtVolume } from '../core/format';

export interface FetchDraft {
  code: string;
  providerId: string;
  begin: string;
  end: string;
  target: 'current' | 'new';
}

interface Props {
  activeStock: Stock | null;
  onRun: (draft: FetchDraft) => Promise<FetchResult | null>;
}

export function FetchPanel({ activeStock, onRun }: Props) {
  const [code, setCode] = useState(activeStock?.code ?? '');
  const [providerId, setProviderId] = useState<string>(PROVIDER_ORDER[0]);
  const [begin, setBegin] = useState('');
  const [end, setEnd] = useState('');
  const [target, setTarget] = useState<'current' | 'new'>('current');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FetchResult | null>(null);

  useEffect(() => {
    setCode(activeStock?.code ?? '');
    setResult(null);
    setError(null);
  }, [activeStock?.id, activeStock?.code]);

  const provider = PROVIDERS[providerId];
  const normalized = (() => {
    try {
      return toSecid(code || '600000');
    } catch {
      return '';
    }
  })();

  const run = async () => {
    if (!code.trim()) {
      setError('请先填写股票代码');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await onRun({ code: code.trim(), providerId, begin, end, target });
      if (res) setResult(res);
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const previewRows = result?.bars.slice(-6).slice().reverse() ?? [];

  return (
    <div className="panel-body">
      <div className="fetch-card">
        <div className="field">
          <label className="field-label">股票代码</label>
          <input
            className="input mono"
            value={code}
            placeholder="600000 / sh600000 / 000001"
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void run();
            }}
          />
          <div className="field-hint">
            {normalized ? `接口标识：${normalized}` : '代码需为 6 位数字，可带 sh / sz / bj 前缀'}
          </div>
        </div>

        <div className="field">
          <label className="field-label">数据源</label>
          <select className="select" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {PROVIDER_ORDER.map((id) => (
              <option key={id} value={id}>
                {PROVIDERS[id].meta.label}
              </option>
            ))}
          </select>
          <div className="field-hint">{provider?.meta.hint}</div>
        </div>

        <div className="field-row">
          <div className="field">
            <label className="field-label">起始日期（可选）</label>
            <input className="input" type="date" value={begin} onChange={(e) => setBegin(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">结束日期（可选）</label>
            <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label className="field-label">写入目标</label>
          <select
            className="select"
            value={target}
            onChange={(e) => setTarget(e.target.value as 'current' | 'new')}
          >
            <option value="current">覆盖当前股票（{activeStock ? activeStock.name : '无'}）</option>
            <option value="new">新建一只股票并切换过去</option>
          </select>
        </div>

        <div className="btn-row">
          <button className="btn primary" type="button" onClick={() => void run()} disabled={busy || !code.trim()}>
            {busy ? '正在拉取…' : '拉取并生成 K 线'}
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setBegin('');
              setEnd('');
              setCode(activeStock?.code ?? '');
              setResult(null);
              setError(null);
            }}
          >
            重置
          </button>
        </div>
      </div>

      {error && (
        <div className="result error-box">
          <div className="result-head">
            <span className="tag-err">拉取失败</span>
          </div>
          <p className="err-text">{error}</p>
          <p className="hint">
            常见原因：代码不存在 / 该市场无权限 / 浏览器或网络拦截了跨域请求。可以换「离线演示」数据源先验证流程，或用「历史数据」页签手动粘贴。
          </p>
        </div>
      )}

      {result && (
        <div className="result">
          <div className="result-head">
            <span className="tag-ok">已写入 {result.bars.length} 根</span>
            <span className="muted">
              {result.name ? `${result.name} · ` : ''}
              {result.code ?? ''}
            </span>
          </div>
          <div className="stat-grid tight">
            <div className="stat">
              <span className="muted">区间</span>
              <b>
                {result.bars[0]?.date} ~ {result.bars[result.bars.length - 1]?.date}
              </b>
            </div>
            <div className="stat">
              <span className="muted">数据源</span>
              <b>{result.source}</b>
            </div>
          </div>
          <table className="mini-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>开</th>
                <th>高</th>
                <th>低</th>
                <th>收</th>
                <th>量</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((b) => (
                <tr key={b.date}>
                  <td>{b.date}</td>
                  <td>{fmtPrice(b.open)}</td>
                  <td>{fmtPrice(b.high)}</td>
                  <td>{fmtPrice(b.low)}</td>
                  <td className={b.close >= b.open ? 'up' : 'down'}>{fmtPrice(b.close)}</td>
                  <td>{fmtVolume(b.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">已按前复权日线写入，旧预演已清空；可在「预演」页签继续推演后面的交易日。</p>
        </div>
      )}

      <p className="hint">
        接口说明：默认使用东方财富公开行情（前复权日线、沪深京 A 股）。数据请求优先走 JSONP，
        开发环境还可经 Vite 代理 <code>/api/em-his</code> 转发，因此本地 <code>npm run dev</code> 一般不会被跨域拦。
        静态部署时若接口收紧跨域策略，可自行加一层自己的后端代理。
      </p>
    </div>
  );
}
