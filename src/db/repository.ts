import { STORE, deleteByStock, deleteOne, getAll, getAllByIndex, putMany, putOne } from './indexDB';
import type { AiConfig } from '../ai/types';
import { AI_DEFAULTS } from '../ai/types';
import type { Bar, BarRecord, ForecastBar, ForecastRecord, Stock } from '../core/types';

const GLOBAL_AI_KEY = '__global__';

const keyOf = (stockId: string, date: string) => `${stockId}|${date}`;

export async function listStocks(): Promise<Stock[]> {
  const stocks = await getAll<Stock>(STORE.stocks);
  return stocks.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveStock(stock: Stock): Promise<void> {
  await putOne(STORE.stocks, { ...stock, updatedAt: Date.now() });
}

export async function removeStock(stockId: string): Promise<void> {
  await deleteByStock(STORE.bars, stockId);
  await deleteByStock(STORE.forecasts, stockId);
  await deleteOne(STORE.stocks, stockId);
}

function toRecord(stockId: string, bar: Bar): BarRecord {
  return { ...bar, key: keyOf(stockId, bar.date), stockId };
}

export async function loadBars(stockId: string): Promise<Bar[]> {
  const records = await getAllByIndex<BarRecord>(STORE.bars, 'byStock', stockId);
  return records
    .map(({ key: _key, stockId: _stockId, ...bar }) => bar)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function replaceBars(stockId: string, bars: Bar[]): Promise<void> {
  await deleteByStock(STORE.bars, stockId);
  await putMany(STORE.bars, bars.map((bar) => toRecord(stockId, bar)));
}

export async function appendBars(stockId: string, bars: Bar[]): Promise<void> {
  await putMany(STORE.bars, bars.map((bar) => toRecord(stockId, bar)));
}

export async function clearBars(stockId: string): Promise<void> {
  await deleteByStock(STORE.bars, stockId);
}

function forecastToRecord(stockId: string, bar: ForecastBar): ForecastRecord {
  return { ...bar, key: keyOf(stockId, bar.date), stockId };
}

export async function loadForecasts(stockId: string): Promise<ForecastBar[]> {
  const records = await getAllByIndex<ForecastRecord>(STORE.forecasts, 'byStock', stockId);
  return records
    .map(({ key: _key, stockId: _stockId, ...bar }) => bar)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function replaceForecasts(stockId: string, bars: ForecastBar[]): Promise<void> {
  await deleteByStock(STORE.forecasts, stockId);
  await putMany(STORE.forecasts, bars.map((bar) => forecastToRecord(stockId, bar)));
}

export async function clearForecasts(stockId: string): Promise<void> {
  await deleteByStock(STORE.forecasts, stockId);
}

export interface StockSnapshot {
  stock: Stock;
  bars: Bar[];
  forecasts: ForecastBar[];
  exportedAt: string;
}

export async function exportStock(stockId: string): Promise<StockSnapshot | null> {
  const stocks = await listStocks();
  const stock = stocks.find((s) => s.id === stockId);
  if (!stock) return null;
  return {
    stock,
    bars: await loadBars(stockId),
    forecasts: await loadForecasts(stockId),
    exportedAt: new Date().toISOString(),
  };
}

export async function loadAiConfig(stockId = GLOBAL_AI_KEY): Promise<AiConfig | null> {
  const configs = await getAll<AiConfig>(STORE.aiConfigs);
  const found = configs.find((c) => c.stockId === stockId);
  if (!found) return null;
  return {
    ...found,
    baseUrl: found.baseUrl || AI_DEFAULTS.baseUrl,
    model: found.model || AI_DEFAULTS.model,
    apiKey: found.apiKey ?? '',
    temperature: found.temperature ?? AI_DEFAULTS.temperature,
  };
}

export async function saveAiConfig(config: AiConfig): Promise<void> {
  await putOne(STORE.aiConfigs, {
    stockId: GLOBAL_AI_KEY,
    baseUrl: config.baseUrl || AI_DEFAULTS.baseUrl,
    model: config.model || AI_DEFAULTS.model,
    apiKey: config.apiKey ?? '',
    temperature: config.temperature ?? AI_DEFAULTS.temperature,
    updatedAt: Date.now(),
  });
}
