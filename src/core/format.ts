export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '--';
  return n.toFixed(2);
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '--';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function fmtVolume(v: number | null | undefined): string {
  if (!v || !Number.isFinite(v)) return '--';
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return String(Math.round(v));
}

export function fmtSignedPrice(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

/** pct 为百分比数值，例如 3 表示 +3% */
export function pctChange(from: number, to: number): number {
  if (!from) return 0;
  return ((to - from) / from) * 100;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
