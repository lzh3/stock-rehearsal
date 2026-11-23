import type { Bar, Board, ForecastBar, Stock } from '../core/types';
import { BOARDS } from '../core/limit';
import { fmtPrice, fmtVolume } from '../core/format';

interface Props {
  stock: Stock;
  bars: Bar[];
  forecasts: ForecastBar[];
  onUpdate: (stock: Stock) => Promise<void>;
  onExport: () => Promise<void>;
  onClearHistory: () => Promise<void>;
  onClearForecasts: () => Promise<void>;
}

export function DataPanel({ stock, bars, forecasts, onUpdate, onExport, onClearHistory, onClearForecasts }: Props) {
  const first = bars[0];
  const last = bars[bars.length - 1];
  const totalVolume = bars.reduce((sum, b) => sum + b.volume, 0);

  return (
    <div className="panel-body">
      <div className="field-row">
        <div className="field">
          <label className="field-label">股票名称</label>
          <input
            className="input"
            value={stock.name}
            onChange={(e) => void onUpdate({ ...stock, name: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="field-label">股票代码</label>
          <input
            className="input"
            value={stock.code}
            onChange={(e) => void onUpdate({ ...stock, code: e.target.value })}
          />
        </div>
      </div>

      <div className="field">
        <label className="field-label">板块 / 涨跌停幅度</label>
        <select
          className="select"
          value={stock.board}
          onChange={(e) => void onUpdate({ ...stock, board: e.target.value as Board })}
        >
          {(Object.keys(BOARDS) as Board[]).map((key) => (
            <option key={key} value={key}>
              {BOARDS[key].label}
            </option>
          ))}
        </select>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <span className="muted">历史 K 线</span>
          <b>{bars.length} 根</b>
        </div>
        <div className="stat">
          <span className="muted">预演 K 线</span>
          <b>{forecasts.length} 根</b>
        </div>
        <div className="stat">
          <span className="muted">数据区间</span>
          <b>{first && last ? `${first.date} ~ ${last.date}` : '--'}</b>
        </div>
        <div className="stat">
          <span className="muted">最新收盘</span>
          <b>{last ? fmtPrice(last.close) : '--'}</b>
        </div>
        <div className="stat">
          <span className="muted">累计成交量</span>
          <b>{fmtVolume(totalVolume)}</b>
        </div>
        <div className="stat">
          <span className="muted">存储</span>
          <b>IndexedDB</b>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn" type="button" onClick={() => void onExport()} disabled={!bars.length}>
          导出 JSON
        </button>
        <button className="btn danger" type="button" onClick={() => void onClearForecasts()} disabled={!forecasts.length}>
          清空预演
        </button>
        <button className="btn danger" type="button" onClick={() => void onClearHistory()} disabled={!bars.length}>
          清空历史
        </button>
      </div>

      <p className="hint">
        所有数据保存在浏览器 IndexedDB（库名 <code>stock-mock-db</code>），刷新、关页面都不会丢。清理浏览器站点数据会一并删除。
      </p>
    </div>
  );
}
