import type { Bar, Stock } from '../core/types';
import { round2 } from '../core/format';
import { isWeekend, shiftDays } from '../core/dates';
import { saveStock, appendBars } from './repository';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tradingDaysEnding(endDate: string, count: number): string[] {
  const dates: string[] = [];
  let cur = endDate;
  while (dates.length < count) {
    if (!isWeekend(cur)) dates.push(cur);
    cur = shiftDays(cur, -1);
  }
  return dates.reverse();
}

/** 生成一份确定性的演示行情，方便首次打开就有图可看 */
export function buildDemoData(endDate: string, count = 90): Bar[] {
  const rng = mulberry32(20261118);
  const dates = tradingDaysEnding(endDate, count);
  const bars: Bar[] = [];
  let prevClose = 9.6;

  dates.forEach((date, i) => {
    const trend = i < count * 0.45 ? 0.55 : i < count * 0.7 ? -0.15 : 0.35;
    const shock = (rng() - 0.5) * 5.2 + trend;
    const gap = (rng() - 0.5) * 1.4;
    const open = round2(prevClose * (1 + gap / 100));
    const close = Math.max(1, round2(open * (1 + shock / 100)));
    const wick = Math.abs(shock) * 0.8 + rng() * 1.2;
    const high = round2(Math.max(open, close) * (1 + (wick / 100) * rng()));
    const low = round2(Math.min(open, close) * (1 - (wick / 100) * rng()));
    const volume = Math.round(3.6e6 * (0.55 + rng() * 1.5) * (1 + Math.abs(shock) / 6));
    bars.push({ date, open, high, low: Math.min(low, open, close), close, volume });
    prevClose = close;
  });

  return bars;
}

export async function seedDemoStock(endDate: string): Promise<{ stock: Stock; bars: Bar[] }> {
  const now = Date.now();
  const stock: Stock = {
    id: crypto.randomUUID(),
    code: '600000',
    name: '示例股份',
    board: 'main',
    createdAt: now,
    updatedAt: now,
  };
  const bars = buildDemoData(endDate);
  await saveStock(stock);
  await appendBars(stock.id, bars);
  return { stock, bars };
}
