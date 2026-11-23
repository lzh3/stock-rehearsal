import type { Bar } from '../../core/types';
import { round2 } from '../../core/format';
import { isWeekend, lastTradingDayOnOrBefore, shiftDays, todayStr } from '../../core/dates';
import type { FetchRange, FetchResult, HistoryProvider, ProviderMeta } from './index';

/** 离线演示数据源：不联网，按代码生成确定性行情，用于验证拉取 → 存库 → 画 K 线 的完整链路 */

export const mockMeta: ProviderMeta = {
  id: 'mock',
  label: '离线演示（不联网）',
  hint: '断网也能验证流程：按代码生成固定随机行情，条数与日期范围与真实接口一致',
};

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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
  let guard = 0;
  while (dates.length < count && guard < count * 3 + 20) {
    if (!isWeekend(cur)) dates.push(cur);
    cur = shiftDays(cur, -1);
    guard += 1;
  }
  return dates.reverse();
}

export function generateMockBars(code: string, count = 240, endDate = lastTradingDayOnOrBefore(todayStr())): Bar[] {
  const normalized = code.replace(/\D/g, '') || '600000';
  const rng = mulberry32(hashSeed(normalized));
  const dates = tradingDaysEnding(endDate, count);

  const bars: Bar[] = [];
  let prevClose = round2(6 + rng() * 24);

  dates.forEach((date, i) => {
    const wave = Math.sin(i / 11) * 0.55 + Math.sin(i / 37) * 0.9;
    const drift = i < count * 0.4 ? 0.5 : i < count * 0.65 ? -0.2 : 0.35;
    const shock = (rng() - 0.5) * 4.6 + drift + wave;
    const gap = (rng() - 0.5) * 1.3;

    const open = round2(prevClose * (1 + gap / 100));
    const close = Math.max(0.5, round2(open * (1 + shock / 100)));
    const wick = Math.abs(shock) * 0.7 + rng() * 1.1;
    const high = round2(Math.max(open, close) * (1 + (wick / 100) * rng()));
    const low = round2(Math.min(open, close) * (1 - (wick / 100) * rng()));
    const volume = Math.round(2.4e6 * (0.5 + rng() * 1.6) * (1 + Math.abs(shock) / 5));

    bars.push({ date, open, high, low: Math.min(low, open, close), close, volume });
    prevClose = close;
  });

  return bars;
}

export class MockProvider implements HistoryProvider {
  readonly meta = mockMeta;

  async fetchHistory(code: string, range: FetchRange): Promise<FetchResult> {
    const end = range.end && range.end.length === 10 ? range.end : lastTradingDayOnOrBefore(todayStr());
    const all = generateMockBars(code, 260, end);
    const bars = range.begin ? all.filter((b) => b.date >= range.begin!) : all;

    // 模拟一次网络往返，便于观察 loading 状态
    await new Promise((resolve) => setTimeout(resolve, 260));

    if (!bars.length) throw new Error('该日期范围内没有数据');

    const normalized = code.replace(/\D/g, '');
    return {
      bars,
      source: mockMeta.label,
      fetchedAt: Date.now(),
      name: `演示${normalized.slice(-3)}`,
      code: normalized,
    };
  }
}
