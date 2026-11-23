import { useCallback, useEffect, useMemo, useState } from 'react';
import { KLineChart } from './components/KLineChart';
import { FetchPanel } from './components/FetchPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { ForecastPanel } from './components/ForecastPanel';
import { StockManager } from './components/StockManager';
import { DataPanel } from './components/DataPanel';
import type { Bar, Board, ForecastBar, Stock } from './core/types';
import { BOARDS, guessBoard } from './core/limit';
import { fmtPct, fmtPrice } from './core/format';
import { lastTradingDayOnOrBefore, nextTradingDay, todayStr, tradingDaysFrom } from './core/dates';
import { parseForecastKeywords } from './core/parseForecast';
import type { AiConfig } from './ai/types';
import { getProvider, type FetchDraft, type FetchResult } from './data';
import { fetchStockProfile } from './data/providers/eastmoneyProfile';
import * as repo from './db/repository';
import { seedDemoStock } from './db/seed';

type TabKey = 'history' | 'fetch' | 'forecast' | 'stocks' | 'data';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'history', label: '历史数据' },
  { key: 'fetch', label: '自动拉取' },
  { key: 'forecast', label: '预演' },
  { key: 'stocks', label: '股票' },
  { key: 'data', label: '数据' },
];

interface BootstrapResult {
  stocks: Stock[];
  activeId: string;
}

let bootstrapPromise: Promise<BootstrapResult> | null = null;

function bootstrap(): Promise<BootstrapResult> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const existing = await repo.listStocks();
      if (existing.length) return { stocks: existing, activeId: existing[0].id };
      const end = lastTradingDayOnOrBefore(todayStr());
      const { stock } = await seedDemoStock(end);
      return { stocks: [stock], activeId: stock.id };
    })();
  }
  return bootstrapPromise;
}

interface Toast {
  id: number;
  kind: 'ok' | 'warn' | 'err';
  text: string;
}

export default function App() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [forecasts, setForecasts] = useState<ForecastBar[]>([]);
  const [tab, setTab] = useState<TabKey>('history');
  const [maPeriods, setMaPeriods] = useState<number[]>([5, 10, 20]);
  const [showVolume, setShowVolume] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);

  const notify = useCallback((kind: Toast['kind'], text: string) => {
    setToast({ id: Date.now(), kind, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let alive = true;
    bootstrap()
      .then(async ({ stocks: list, activeId: id }) => {
        if (!alive) return;
        setStocks(list);
        setActiveId(id);
        setAiConfig(await repo.loadAiConfig());
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        notify('err', `IndexedDB 初始化失败：${(err as Error).message}`);
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [notify]);

  const reloadActive = useCallback(async (id: string) => {
    const [nextBars, nextForecasts] = await Promise.all([repo.loadBars(id), repo.loadForecasts(id)]);
    setBars(nextBars);
    setForecasts(nextForecasts);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    (async () => {
      const [nextBars, nextForecasts] = await Promise.all([repo.loadBars(activeId), repo.loadForecasts(activeId)]);
      if (!alive) return;
      setBars(nextBars);
      setForecasts(nextForecasts);
      setResetSignal((s) => s + 1);
    })();
    return () => {
      alive = false;
    };
  }, [activeId]);

  const activeStock = useMemo(() => stocks.find((s) => s.id === activeId) ?? null, [stocks, activeId]);
  const lastBar = bars.length ? bars[bars.length - 1] : null;
  const prevBar = bars.length > 1 ? bars[bars.length - 2] : null;

  const refreshStocks = useCallback(async () => {
    const list = await repo.listStocks();
    setStocks(list);
    return list;
  }, []);

  const handleImportHistory = async (incoming: Bar[], mode: 'replace' | 'append') => {
    if (!activeId) return;
    if (mode === 'replace') await repo.replaceBars(activeId, incoming);
    else await repo.appendBars(activeId, incoming);
    await repo.clearForecasts(activeId);
    await reloadActive(activeId);
    setResetSignal((s) => s + 1);
    notify('ok', `${mode === 'replace' ? '覆盖' : '追加'}导入 ${incoming.length} 根 K 线（旧预演已清空）`);
  };

  const handleGenerateForecast = async (text: string, startDate: string) => {
    if (!activeId || !activeStock || !lastBar) {
      notify('warn', '请先导入历史数据');
      return;
    }
    const { days } = parseForecastKeywords(text, lastBar.close, lastBar.volume, activeStock.board);
    if (!days.length) {
      notify('warn', '没有解析出任何交易日');
      return;
    }
    const safeStart = startDate && startDate > lastBar.date ? startDate : nextTradingDay(lastBar.date);
    const dates = tradingDaysFrom(safeStart, days.length);
    const records: ForecastBar[] = days.map((d, i) => ({
      date: dates[i] ?? safeStart,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
      note: d.note,
      tags: d.tags,
    }));
    await repo.replaceForecasts(activeId, records);
    await reloadActive(activeId);
    setResetSignal((s) => s + 1);
    notify('ok', `已生成 ${records.length} 天预演（${records[0].date} 起）`);
  };

  const handleAutoFetch = async (draft: FetchDraft): Promise<FetchResult | null> => {
    if (!activeId && draft.target === 'current') {
      notify('warn', '当前没有可覆盖的股票，将新建一只');
    }
    const shouldCreate = draft.target === 'new' || !activeId;
    const provider = getProvider(draft.providerId);
    const result = await provider.fetchHistory(draft.code, { begin: draft.begin, end: draft.end });
    const digits = (result.code ?? draft.code).replace(/\D/g, '').slice(-6);
    if (!digits) throw new Error('无法解析股票代码');

    let stockId: string;
    if (shouldCreate) {
      const now = Date.now();
      const stock: Stock = {
        id: crypto.randomUUID(),
        code: digits,
        name: result.name ?? `股票${digits}`,
        board: guessBoard(digits),
        createdAt: now,
        updatedAt: now,
      };
      await repo.saveStock(stock);
      await refreshStocks();
      stockId = stock.id;
      setActiveId(stock.id);
    } else {
      const current = stocks.find((s) => s.id === activeId)!;
      const next: Stock = {
        ...current,
        code: digits,
        name: result.name ?? current.name,
        board: guessBoard(digits),
      };
      stockId = current.id;
      setStocks((prev) => prev.map((s) => (s.id === current.id ? next : s)));
      await repo.saveStock(next);
    }

    await repo.replaceBars(stockId, result.bars);
    await repo.clearForecasts(stockId);
    await reloadActive(stockId);
    setResetSignal((s) => s + 1);
    notify(
      'ok',
      `${result.source}: 已写入 ${result.bars.length} 根 ${
        result.bars[0]?.date
      }~${result.bars[result.bars.length - 1]?.date}`
    );
    return result;
  };

  const handleClearForecasts = async () => {
    if (!activeId) return;
    await repo.clearForecasts(activeId);
    await reloadActive(activeId);
    setResetSignal((s) => s + 1);
    notify('ok', '预演数据已清空');
  };

  const handleClearHistory = async () => {
    if (!activeId) return;
    if (!window.confirm('确定清空该股票的全部历史 K 线吗？')) return;
    await repo.clearBars(activeId);
    await repo.clearForecasts(activeId);
    await reloadActive(activeId);
    setResetSignal((s) => s + 1);
    notify('ok', '历史数据已清空');
  };

  const handleExport = async () => {
    if (!activeId) return;
    const snapshot = await repo.exportStock(activeId);
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${snapshot.stock.code || 'stock'}-${snapshot.stock.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('ok', '已导出 JSON');
  };

  const handleCreateStock = async (name: string, code: string) => {
    const now = Date.now();
    const stock: Stock = {
      id: crypto.randomUUID(),
      code,
      name,
      board: guessBoard(code),
      createdAt: now,
      updatedAt: now,
    };
    await repo.saveStock(stock);
    await refreshStocks();
    setActiveId(stock.id);
    setTab('history');
    notify('ok', `已新建 ${name}${code ? `（${code}）` : ''}`);
  };

  const handleUpdateStock = async (stock: Stock) => {
    setStocks((prev) => prev.map((s) => (s.id === stock.id ? stock : s)));
    await repo.saveStock(stock);
  };

  const handleSaveAiConfig = async (config: AiConfig) => {
    await repo.saveAiConfig(config);
    setAiConfig((prev) => ({ ...prev, ...config }));
  };

  const handleSaveFundamentals = async (text: string) => {
    if (!activeId || !activeStock) return;
    const next: Stock = { ...activeStock, fundamentals: text };
    setStocks((prev) => prev.map((s) => (s.id === activeId ? next : s)));
    await repo.saveStock(next);
    notify('ok', '基本面已保存');
  };

  const handleFetchProfile = async () => {
    if (!activeStock) return;
    const profile = await fetchStockProfile(activeStock.code || activeStock.name);
    const next: Stock = {
      ...activeStock,
      code: activeStock.code || profile.code,
      name: activeStock.name && activeStock.name !== '未命名' ? activeStock.name : profile.name || activeStock.name,
      profile,
    };
    setStocks((prev) => prev.map((s) => (s.id === next.id ? next : s)));
    await repo.saveStock(next);
    notify('ok', `已获取 ${profile.industry ?? '行业'} · 市值 ${profile.totalCap ? (profile.totalCap / 1e8).toFixed(0) + '亿' : '未知'}`);
  };

  const handleDeleteStock = async (stock: Stock) => {
    await repo.removeStock(stock.id);
    const list = await refreshStocks();
    if (stock.id === activeId) {
      setActiveId(list.length ? list[0].id : null);
      if (!list.length) {
        setBars([]);
        setForecasts([]);
      }
    }
    notify('ok', `已删除「${stock.name}」`);
  };

  const handleSeed = async () => {
    const end = lastTradingDayOnOrBefore(todayStr());
    const { stock } = await seedDemoStock(end);
    await refreshStocks();
    setActiveId(stock.id);
    notify('ok', '已载入演示行情');
  };

  const toggleMa = (period: number) => {
    setMaPeriods((prev) =>
      prev.includes(period) ? prev.filter((p) => p !== period) : [...prev, period].sort((a, b) => a - b),
    );
  };

  const lastPct = lastBar && prevBar ? ((lastBar.close - prevBar.close) / prevBar.close) * 100 : null;

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">K</span>
          <span className="brand-text">
            K 线预演
            <em>StockMock</em>
          </span>
        </div>

        <div className="stock-switcher">
          <select
            className="select compact"
            value={activeId ?? ''}
            onChange={(e) => setActiveId(e.target.value || null)}
            disabled={!stocks.length}
          >
            {!stocks.length && <option value="">（无股票）</option>}
            {stocks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ? `${s.code} ` : ''}
                {s.name}
              </option>
            ))}
          </select>
          {activeStock && (
            <select
              className="select compact"
              value={activeStock.board}
              onChange={(e) => void handleUpdateStock({ ...activeStock, board: e.target.value as Board })}
              title="板块决定涨跌停幅度"
            >
              {(Object.keys(BOARDS) as Board[]).map((key) => (
                <option key={key} value={key}>
                  {BOARDS[key].short}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="header-stats">
          {lastBar ? (
            <>
              <span className="stat-inline">
                <span className="muted">最新</span>
                <b className={lastPct != null && lastPct >= 0 ? 'up' : 'down'}>{fmtPrice(lastBar.close)}</b>
              </span>
              <span className={`pill ${lastPct != null && lastPct >= 0 ? 'up' : 'down'}`}>
                {fmtPct(lastPct ?? 0)}
              </span>
              <span className="stat-inline muted">{lastBar.date}</span>
            </>
          ) : (
            <span className="muted">暂无数据</span>
          )}
        </div>
      </header>

      <main className="app-main">
        <section className="chart-area">
          <div className="chart-toolbar">
            <div className="toolbar-left">
              <span className="chart-title">
                {activeStock ? activeStock.name : '未选择股票'}
                {activeStock?.code && <em>{activeStock.code}</em>}
              </span>
              <span className="muted small">
                {bars.length} 根历史{forecasts.length ? ` · ${forecasts.length} 天预演` : ''}
              </span>
            </div>
            <div className="toolbar-right">
              {[5, 10, 20, 60].map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`toggle ${maPeriods.includes(p) ? 'active' : ''}`}
                  onClick={() => toggleMa(p)}
                >
                  MA{p}
                </button>
              ))}
              <button
                type="button"
                className={`toggle ${showVolume ? 'active' : ''}`}
                onClick={() => setShowVolume((v) => !v)}
              >
                VOL
              </button>
              <button type="button" className="toggle" onClick={() => setResetSignal((s) => s + 1)}>
                复位
              </button>
            </div>
          </div>

          <KLineChart
            bars={bars}
            forecasts={forecasts}
            maPeriods={maPeriods}
            showVolume={showVolume}
            resetSignal={resetSignal}
          />
        </section>

        <aside className="side-panel">
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`tab ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="panel-scroll">
            {!ready && <div className="panel-body muted">正在打开 IndexedDB…</div>}

            {ready && tab === 'history' && (
              <HistoryPanel existingCount={bars.length} onImport={handleImportHistory} />
            )}

            {ready && tab === 'fetch' && <FetchPanel activeStock={activeStock} onRun={handleAutoFetch} />}

            {ready && tab === 'forecast' && (
              <ForecastPanel
                stock={activeStock}
                bars={bars}
                lastBar={lastBar}
                board={activeStock?.board ?? 'main'}
                forecastCount={forecasts.length}
                config={aiConfig ?? null}
                onGenerate={handleGenerateForecast}
                onClear={handleClearForecasts}
                onSaveConfig={handleSaveAiConfig}
                onSaveFundamentals={handleSaveFundamentals}
                onFetchProfile={handleFetchProfile}
              />
            )}

            {ready && tab === 'stocks' && (
              <StockManager
                stocks={stocks}
                activeId={activeId}
                onSelect={(id) => setActiveId(id)}
                onCreate={handleCreateStock}
                onDelete={handleDeleteStock}
                onSeed={handleSeed}
              />
            )}

            {ready && tab === 'data' &&
              (activeStock ? (
                <DataPanel
                  stock={activeStock}
                  bars={bars}
                  forecasts={forecasts}
                  onUpdate={handleUpdateStock}
                  onExport={handleExport}
                  onClearHistory={handleClearHistory}
                  onClearForecasts={handleClearForecasts}
                />
              ) : (
                <div className="panel-body muted">请先选择或新建一只股票</div>
              ))}
          </div>

          <footer className="panel-footer">
            <span className="dot" />
            IndexedDB · stock-mock-db
          </footer>
        </aside>
      </main>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
