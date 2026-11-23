import { useState } from 'react';
import type { Bar } from '../core/types';
import { parseHistory, type HistoryParseResult, type OpenFallback } from '../core/parseHistory';
import { fmtPrice, fmtVolume } from '../core/format';

interface Props {
  existingCount: number;
  onImport: (bars: Bar[], mode: 'replace' | 'append') => Promise<void>;
}

const PLACEHOLDER = `每行一条，支持以下格式（空格 / 逗号 / Tab 分隔）：

2026-10-09  12.35  12.88  12.20  12.71
2026-10-10  12.70  13.05  12.55  12.98  128000
2026-10-13,12.95,13.40,12.80,13.31,152000

• 3 列 → 最高 最低 收盘（开盘价自动推导）
• 4 列 → 开 高 低 收
• 5 列及以上 → 开 高 低 收 量 [额]
• 日期支持 2026-10-09 / 2026/10/09 / 20261009 / 2026年10月9日 / 10-09`;

export function HistoryPanel({ existingCount, onImport }: Props) {
  const [text, setText] = useState('');
  const [openFallback, setOpenFallback] = useState<OpenFallback>('prevClose');
  const [parsed, setParsed] = useState<HistoryParseResult | null>(null);
  const [busy, setBusy] = useState(false);

  const doParse = () => setParsed(parseHistory(text, openFallback));

  const doImport = async (mode: 'replace' | 'append') => {
    const result = parseHistory(text, openFallback);
    setParsed(result);
    if (!result.bars.length) return;
    setBusy(true);
    try {
      await onImport(result.bars, mode);
    } finally {
      setBusy(false);
    }
  };

  const preview = parsed?.bars ?? [];
  const headRows = preview.slice(0, 6);
  const tailRows = preview.length > 8 ? preview.slice(-3) : [];

  return (
    <div className="panel-body">
      <div className="field">
        <label className="field-label">历史行情数据</label>
        <textarea
          className="textarea mono"
          value={text}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label className="field-label">缺少开盘价时</label>
          <select
            className="select"
            value={openFallback}
            onChange={(e) => setOpenFallback(e.target.value as OpenFallback)}
          >
            <option value="prevClose">用上一日收盘价（推荐）</option>
            <option value="close">用当日收盘价</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">库中现有</label>
          <div className="readonly-stat">{existingCount} 根</div>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn ghost" type="button" onClick={doParse} disabled={!text.trim()}>
          解析预览
        </button>
        <button className="btn primary" type="button" onClick={() => doImport('replace')} disabled={!text.trim() || busy}>
          覆盖导入
        </button>
        <button className="btn" type="button" onClick={() => doImport('append')} disabled={!text.trim() || busy}>
          追加导入
        </button>
      </div>

      {parsed && (
        <div className="result">
          <div className="result-head">
            <span className={preview.length ? 'tag-ok' : 'tag-err'}>
              {preview.length ? `解析成功 ${preview.length} 根` : '未解析出数据'}
            </span>
            {parsed.formatHint && <span className="muted">{parsed.formatHint}</span>}
          </div>

          {preview.length > 0 && (
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
                {headRows.map((b) => (
                  <tr key={b.date}>
                    <td>{b.date}</td>
                    <td>{fmtPrice(b.open)}</td>
                    <td>{fmtPrice(b.high)}</td>
                    <td>{fmtPrice(b.low)}</td>
                    <td className={b.close >= b.open ? 'up' : 'down'}>{fmtPrice(b.close)}</td>
                    <td>{fmtVolume(b.volume)}</td>
                  </tr>
                ))}
                {tailRows.length > 0 && (
                  <>
                    <tr className="ellipsis-row">
                      <td colSpan={6}>… 省略 {preview.length - headRows.length - tailRows.length} 行 …</td>
                    </tr>
                    {tailRows.map((b) => (
                      <tr key={b.date}>
                        <td>{b.date}</td>
                        <td>{fmtPrice(b.open)}</td>
                        <td>{fmtPrice(b.high)}</td>
                        <td>{fmtPrice(b.low)}</td>
                        <td className={b.close >= b.open ? 'up' : 'down'}>{fmtPrice(b.close)}</td>
                        <td>{fmtVolume(b.volume)}</td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          )}

          {parsed.warnings.length > 0 && (
            <ul className="issue-list warn">
              {parsed.warnings.slice(0, 5).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {parsed.errors.length > 0 && (
            <ul className="issue-list err">
              {parsed.errors.slice(0, 6).map((e, i) => (
                <li key={i}>
                  第 {e.line} 行：{e.message}
                </li>
              ))}
              {parsed.errors.length > 6 && <li>… 另有 {parsed.errors.length - 6} 条问题</li>}
            </ul>
          )}
        </div>
      )}

      <p className="hint">
        导入历史数据会清空已有预演，避免预演结果与新的收盘价脱节。
      </p>
    </div>
  );
}
