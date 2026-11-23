import type { Bar } from './types';

/** values 中非有限值的元素会被跳过，返回值对齐输入下标，无法计算处为 null */
export function movingAverage(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function closesOf(bars: Bar[]): number[] {
  return bars.map((b) => b.close);
}

export const MA_COLORS: Record<number, string> = {
  5: '#f7b955',
  10: '#4c9aff',
  20: '#c084fc',
  30: '#f472b6',
  60: '#38bdf8',
};

export function maColor(period: number): string {
  return MA_COLORS[period] ?? '#94a3b8';
}
