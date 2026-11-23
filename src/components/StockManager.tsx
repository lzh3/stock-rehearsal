import type { Stock } from '../core/types';
import { BOARDS } from '../core/limit';

interface Props {
  stocks: Stock[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string, code: string) => Promise<void>;
  onDelete: (stock: Stock) => Promise<void>;
  onSeed: () => Promise<void>;
}

export function StockManager({ stocks, activeId, onSelect, onCreate, onDelete, onSeed }: Props) {
  const create = async () => {
    const name = window.prompt('股票名称', '新股票');
    if (name === null) return;
    const code = window.prompt('股票代码（6 位）', '600000');
    if (code === null) return;
    await onCreate(name.trim() || '未命名股票', code.trim());
  };

  const remove = async (stock: Stock) => {
    if (!window.confirm(`确定删除「${stock.name}」及其全部数据吗？此操作无法撤销。`)) return;
    await onDelete(stock);
  };

  return (
    <div className="panel-body stock-manager">
      <div className="stock-list">
        {stocks.map((stock) => (
          <div key={stock.id} className={`stock-item ${activeId === stock.id ? 'active' : ''}`}>
            <button className="stock-select" type="button" onClick={() => onSelect(stock.id)}>
              <span className="stock-code">{stock.code || '------'}</span>
              <span className="stock-name">{stock.name}</span>
              <span className="stock-board">{BOARDS[stock.board].short}</span>
            </button>
            <button className="icon-btn danger" type="button" title="删除股票" onClick={() => void remove(stock)}>
              ×
            </button>
          </div>
        ))}
        {!stocks.length && <div className="empty-state small">列表为空</div>}
      </div>
      <div className="stock-actions">
        <button className="btn primary" type="button" onClick={() => void create()}>
          + 新建股票
        </button>
        <button className="btn" type="button" onClick={() => void onSeed()}>
          载入演示数据
        </button>
      </div>
      <p className="hint">
        股票所属板块决定涨跌停幅度：主板 10%，创业板 / 科创板 20%，北交所 30%，ST 5%。板块在右侧顶部可切换。
      </p>
    </div>
  );
}
