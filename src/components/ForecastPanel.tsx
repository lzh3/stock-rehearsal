import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiConfig } from '../ai/types';
import { AiAnalysis } from './AiAnalysis';
import type { Bar, Board, Stock } from '../core/types';
import { KEYWORD_HINTS, parseForecastKeywords } from '../core/parseForecast';
import { limitPrices, BOARDS } from '../core/limit';
import { fmtPct, fmtPrice, fmtVolume } from '../core/format';
import { nextTradingDay, todayStr, tradingDaysFrom } from '../core/dates';

interface Props {
  stock: Stock | null;
  bars: Bar[];
  lastBar: Bar | null;
  board: Board;
  forecastCount: number;
  config: AiConfig | null;
  onGenerate: (text: string, startDate: string) => Promise<void>;
  onClear: () => Promise<void>;
  onSaveConfig: (config: AiConfig) => Promise<void>;
  onSaveFundamentals: (text: string) => Promise<void>;
  onFetchProfile: () => Promise<void>;
}

const PLACEHOLDER = `每行 = 一个交易日，行内可写多个关键词：

涨停
高开3% 涨停 缩量
收+5% 放量
平开 收-2% 最低-4%
一字涨停
收=13.68 量+50%`;

export function ForecastPanel({
  stock,
  bars,
  lastBar,
  board,
  forecastCount,
  config,
  onGenerate,
  onClear,
  onSaveConfig,
  onSaveFundamentals,
  onFetchProfile,
}: Props) {
  const [text, setText] = useState('涨停\n高开2% 涨停\n放量 收+6%\n低开1% 收-3% 缩量');
  const [startDate, setStartDate] = useState('');
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const defaultStart = useMemo(() => {
    if (!lastBar) return todayStr();
    return nextTradingDay(lastBar.date);
  }, [lastBar]);

  useEffect(() => {
    setStartDate(defaultStart);
  }, [defaultStart]);

  const limits = useMemo(() => (lastBar ? limitPrices(lastBar.close, board) : null), [lastBar, board]);

  const parsed = useMemo(() => {
    if (!lastBar) return null;
    return parseForecastKeywords(text, lastBar.close, lastBar.volume, board);
  }, [text, lastBar, board]);

  const days = parsed?.days ?? [];
  const dates = useMemo(() => (startDate ? tradingDaysFrom(startDate, days.length) : []), [startDate, days.length]);

  const insertKeyword = (kw: string) => {
    const el = textRef.current;
    if (!el) {
      setText((t) => (t ? `${t}\n${kw}` : kw));
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${kw}${text.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + kw.length;
      el.selectionEnd = start + kw.length;
    });
  };

  const doGenerate = async () => {
    if (!days.length) return;
    setBusy(true);
    try {
      await onGenerate(text, startDate || defaultStart);
    } finally {
      setBusy(false);
    }
  };

  if (!lastBar) {
    return (
      <div className="panel-body">
        <div className="empty-state">还没有历史数据。先在「历史数据」里导入，或载入示例数据。</div>
      </div>
    );
  }

  return (
    <div className="panel-body">
      <div className="base-info">
        <div>
          <span className="muted">基准日</span>
          <b>{lastBar.date}</b>
        </div>
        <div>
          <span className="muted">基准收盘</span>
          <b>{fmtPrice(lastBar.close)}</b>
        </div>
        <div>
          <span className="muted">涨停</span>
          <b className="up">{limits ? fmtPrice(limits.up) : '--'}</b>
        </div>
        <div>
          <span className="muted">跌停</span>
          <b className="down">{limits ? fmtPrice(limits.down) : '--'}</b>
        </div>
        <div>
          <span className="muted">涨跌停幅度</span>
          <b>±{(BOARDS[board].rate * 100).toFixed(0)}%</b>
        </div>
      </div>

      <div className="field">
        <label className="field-label">预演关键词（每行一天）</label>
        <textarea
          ref={textRef}
          className="textarea mono"
          value={text}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <div className="chips">
        {KEYWORD_HINTS.map((kw) => (
          <button key={kw} type="button" className="chip" onClick={() => insertKeyword(kw)}>
            {kw}
          </button>
        ))}
      </div>

      <div className="field-row">
        <div className="field">
          <label className="field-label">起始交易日</label>
          <input
            className="input"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label">库中预演</label>
          <div className="readonly-stat">{forecastCount} 天</div>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn primary" type="button" onClick={doGenerate} disabled={!days.length || busy}>
          生成预演（覆盖）
        </button>
        <button className="btn ghost" type="button" onClick={() => void onClear()} disabled={!forecastCount}>
          清空预演
        </button>
      </div>

      {days.length > 0 && (
        <div className="result">
          <div className="result-head">
            <span className="tag-ok">推演 {days.length} 个交易日</span>
            <span className="muted">默认开盘=前收，高/低=开收边界</span>
          </div>
          <table className="mini-table">
            <thead>
              <tr>
                <th>#</th>
                <th>日期</th>
                <th>开</th>
                <th>高</th>
                <th>低</th>
                <th>收</th>
                <th>涨跌</th>
                <th>量</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => {
                const prevClose = i === 0 ? lastBar.close : days[i - 1].close;
                const pct = ((d.close - prevClose) / prevClose) * 100;
                return (
                  <tr key={d.index}>
                    <td>{d.index}</td>
                    <td>{dates[i] ?? '--'}</td>
                    <td>{fmtPrice(d.open)}</td>
                    <td className="up">{fmtPrice(d.high)}</td>
                    <td className="down">{fmtPrice(d.low)}</td>
                    <td className={d.close >= prevClose ? 'up' : 'down'}>{fmtPrice(d.close)}</td>
                    <td className={pct >= 0 ? 'up' : 'down'}>{fmtPct(pct)}</td>
                    <td>{fmtVolume(d.volume)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {days.some((d) => d.warnings.length > 0) && (
            <ul className="issue-list warn">
              {days
                .flatMap((d) => d.warnings.map((w) => `第 ${d.index} 天：${w}`))
                .slice(0, 6)
                .map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
            </ul>
          )}
        </div>
      )}

      {stock && (
        <AiAnalysis
          stock={stock}
          bars={bars}
          forecasts={days.map((d, i) => ({
            date: dates[i] ?? startDate,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume,
            note: d.note,
            tags: d.tags,
          }))}
          board={board}
          config={config ?? null}
          onSaveConfig={onSaveConfig}
          onSaveFundamentals={onSaveFundamentals}
          onFetchProfile={onFetchProfile}
        />
      )}

      <p className="hint">
        预演只按「关键词 → 价格」推演收盘后形态，不预测走势。日期仅跳过周末，不含法定节假日。
      </p>
    </div>
  );
}
