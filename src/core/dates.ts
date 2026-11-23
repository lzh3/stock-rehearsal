const pad2 = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseDateStr(s);
  return !Number.isNaN(d.getTime()) && toDateStr(d) === s;
}

export function isWeekend(s: string): boolean {
  const day = parseDateStr(s).getDay();
  return day === 0 || day === 6;
}

export function shiftDays(s: string, delta: number): string {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + delta);
  return toDateStr(d);
}

/**
 * 生成 base 之后（不含 base）的 n 个交易日。
 * 只跳过周末，不识别法定节假日——预演场景够用。
 */
export function tradingDaysAfter(base: string, n: number): string[] {
  const out: string[] = [];
  let cur = base;
  let guard = 0;
  const limit = n * 4 + 16;
  while (out.length < n && guard < limit) {
    guard += 1;
    cur = shiftDays(cur, 1);
    if (!isWeekend(cur)) out.push(cur);
  }
  return out;
}

export function nextTradingDay(base: string): string {
  return tradingDaysAfter(base, 1)[0] ?? shiftDays(base, 1);
}

/** 生成从 base 开始的 n 个交易日（base 是周末则顺延） */
export function tradingDaysFrom(base: string, n: number): string[] {
  const out: string[] = [];
  let cur = base;
  let guard = 0;
  const limit = n * 4 + 16;
  while (out.length < n && guard < limit) {
    if (!isWeekend(cur)) out.push(cur);
    cur = shiftDays(cur, 1);
    guard += 1;
  }
  return out;
}

/** 不晚于 base 的最近一个工作日 */
export function lastTradingDayOnOrBefore(base: string): string {
  let cur = base;
  let guard = 0;
  while (isWeekend(cur) && guard < 10) {
    cur = shiftDays(cur, -1);
    guard += 1;
  }
  return cur;
}

/** 刻度标签：同一年份内省略年份 */
export function shortDate(s: string, withYear = false): string {
  if (withYear) return s.replace(/-/g, '/');
  return s.slice(5).replace('-', '/');
}

export function todayStr(): string {
  return toDateStr(new Date());
}
