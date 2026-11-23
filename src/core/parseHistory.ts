import type { Bar } from './types';
import { round2 } from './format';
import { isValidDateStr } from './dates';

export type OpenFallback = 'prevClose' | 'close';

export interface ParseIssue {
  line: number;
  raw: string;
  message: string;
}

export interface HistoryParseResult {
  bars: Bar[];
  errors: ParseIssue[];
  warnings: string[];
  formatHint: string;
}

const HEADER_WORDS = [
  '日期', '时间', '开盘', '收盘', '最高', '最低', '成交量', '成交额', '涨跌', '振幅', '换手',
  'date', 'time', 'open', 'close', 'high', 'low', 'vol', 'amount',
];

const SEPARATORS = /[\s,;|\t，、；]+/;
const EPS = 1e-6;

function pad2(n: string | number): string {
  return String(n).padStart(2, '0');
}

/** 归一化全角字符与中文标点 */
function normalizeLine(line: string): string {
  return line
    .replace(/[，、；]/g, ',')
    .replace(/：/g, ':')
    .replace(/[／]/g, '/')
    .replace(/[－—–]/g, '-')
    .replace(/％/g, '%')
    .replace(/\u3000/g, ' ')
    .trim();
}

function looksLikeHeader(line: string): boolean {
  const lower = line.toLowerCase();
  if (!HEADER_WORDS.some((w) => lower.includes(w))) return false;
  // 去掉表头文字后基本没有数字，才认为是表头
  const digits = line.replace(/[^\d]/g, '');
  return digits.length < 4;
}

interface DateToken {
  date: string;
  /** MM-DD 形式需要外部补年份 */
  needsYear: boolean;
}

function parseDateToken(tok: string): DateToken | null {
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(tok);
  if (m) {
    const date = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    return isValidDateStr(date) ? { date, needsYear: false } : null;
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(tok);
  if (m) {
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    return isValidDateStr(date) ? { date, needsYear: false } : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(tok);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { date: `0000-${pad2(month)}-${pad2(day)}`, needsYear: true };
    }
  }
  return null;
}

const UNIT_MULTIPLIER: Record<string, number> = { 万: 1e4, 亿: 1e8 };

function parseNumberToken(tok: string): number | null {
  const cleaned = tok.replace(/[%％]/g, '').replace(/(手|股|元|份|张)$/, '');
  const m = /^(-?\d+(?:\.\d+)?)(万|亿)?(手|股|元)?$/.exec(cleaned);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  const mult = m[2] ? UNIT_MULTIPLIER[m[2]] : 1;
  return base * mult;
}

interface RawRow {
  line: number;
  raw: string;
  date: string;
  o: number | null;
  h: number;
  l: number;
  c: number;
  v: number;
  orderedAs?: 'OHLC' | 'OCHL';
}

function isSaneOHLC(o: number, h: number, l: number, c: number): boolean {
  return (
    h + EPS >= Math.max(o, c) &&
    l - EPS <= Math.min(o, c) &&
    h + EPS >= l &&
    l > 0
  );
}

/**
 * 解析粘贴进来的历史数据。支持：
 *   日期 最高 最低 收盘
 *   日期 开 高 低 收
 *   日期 开 高 低 收 量 [额]
 * 分隔符支持空格、Tab、逗号、中文逗号；日期支持 2024-01-02 / 2024-01-02 / 20240102 / 2024年1月2日 / 01-02
 */
export function parseHistory(text: string, openFallback: OpenFallback = 'prevClose'): HistoryParseResult {
  const errors: ParseIssue[] = [];
  const warnings: string[] = [];
  const rows: RawRow[] = [];
  const formatVotes: string[] = [];

  let lastYear = new Date().getFullYear();
  let lastMonth = 0;

  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = normalizeLine(rawLine);
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    if (looksLikeHeader(line)) return;

    const tokens = line.split(SEPARATORS).filter(Boolean);
    let dateInfo: DateToken | null = null;
    let dateIndex = -1;
    for (let i = 0; i < tokens.length; i += 1) {
      const parsed = parseDateToken(tokens[i]);
      if (parsed) {
        dateInfo = parsed;
        dateIndex = i;
        break;
      }
    }
    if (!dateInfo || dateIndex < 0) {
      errors.push({ line: lineNo, raw: rawLine, message: '未识别到日期，已跳过' });
      return;
    }

    let date = dateInfo.date;
    if (dateInfo.needsYear) {
      const month = Number(date.slice(5, 7));
      if (lastMonth && month < lastMonth) lastYear += 1;
      lastMonth = month;
      date = `${lastYear}${date.slice(4)}`;
      if (!isValidDateStr(date)) {
        errors.push({ line: lineNo, raw: rawLine, message: '日期不合法，已跳过' });
        return;
      }
    }

    const nums: number[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      if (i === dateIndex) continue;
      const n = parseNumberToken(tokens[i]);
      if (n == null) {
        if (/[a-zA-Z\u4e00-\u9fa5]/.test(tokens[i])) continue; // 忽略文字标签
        errors.push({ line: lineNo, raw: rawLine, message: `无法解析的数值「${tokens[i]}」` });
        return;
      }
      nums.push(n);
    }

    if (nums.length < 3) {
      errors.push({ line: lineNo, raw: rawLine, message: '数值列不足 3 个（至少需要 最高/最低/收盘）' });
      return;
    }

    let o: number | null;
    let h: number;
    let l: number;
    let c: number;
    let v = 0;
    let orderedAs: RawRow['orderedAs'];

    if (nums.length === 3) {
      o = null;
      [h, l, c] = nums;
      formatVotes.push('日期 高 低 收');
    } else if (nums.length === 4) {
      o = nums[0];
      h = nums[1];
      l = nums[2];
      c = nums[3];
      if (!isSaneOHLC(o, h, l, c)) {
        // 兼容 开/收/高/低 的排列
        const alt = { o: nums[0], c: nums[1], h: nums[2], l: nums[3] };
        if (isSaneOHLC(alt.o, alt.h, alt.l, alt.c)) {
          o = alt.o;
          h = alt.h;
          l = alt.l;
          c = alt.c;
          orderedAs = 'OCHL';
          formatVotes.push('日期 开 收 高 低');
        } else {
          errors.push({
            line: lineNo,
            raw: rawLine,
            message: `价格关系矛盾（高 ${h} 低 ${l} 收 ${c}），已跳过`,
          });
          return;
        }
      } else {
        formatVotes.push('日期 开 高 低 收');
      }
    } else {
      o = nums[0];
      h = nums[1];
      l = nums[2];
      c = nums[3];
      v = nums[4];
      orderedAs = 'OHLC';
      formatVotes.push('日期 开 高 低 收 量');
      if (!isSaneOHLC(o, h, l, c)) {
        errors.push({
          line: lineNo,
          raw: rawLine,
          message: `价格关系矛盾（开 ${o} 高 ${h} 低 ${l} 收 ${c}），已跳过`,
        });
        return;
      }
    }

    if (h <= 0 || l <= 0 || c <= 0) {
      errors.push({ line: lineNo, raw: rawLine, message: '价格必须为正数，已跳过' });
      return;
    }

    rows.push({ line: lineNo, raw: rawLine, date, o, h, l, c, v, orderedAs });
  });

  if (!rows.length) {
    return {
      bars: [],
      errors,
      warnings,
      formatHint: errors.length ? '未解析出任何有效数据' : '没有输入内容',
    };
  }

  // 按日期升序，同一天保留最后一条
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const deduped: RawRow[] = [];
  for (const row of rows) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.date === row.date) {
      deduped[deduped.length - 1] = row;
      warnings.push(`日期 ${row.date} 重复，已保留最后一条（第 ${row.line} 行）`);
    } else {
      deduped.push(row);
    }
  }

  const missingOpenCount = deduped.filter((r) => r.o == null).length;
  const bars: Bar[] = deduped.map((row, i) => {
    let open = row.o;
    if (open == null) {
      const prev = deduped[i - 1];
      open = openFallback === 'prevClose' && prev ? prev.c : row.c;
    }
    let high = Math.max(row.h, open, row.c);
    let low = Math.min(row.l, open, row.c);
    if (high === low) {
      // 一字板，保持原样即可，仅做精度处理
      high = round2(high);
      low = round2(low);
    }
    return {
      date: row.date,
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(row.c),
      volume: Math.max(0, Math.round(row.v)),
    };
  });

  if (missingOpenCount > 0) {
    warnings.push(
      `${missingOpenCount} 条数据缺少开盘价，已按「${
        openFallback === 'prevClose' ? '上一日收盘价' : '当日收盘价'
      }」补齐`,
    );
  }
  const ochl = deduped.filter((r) => r.orderedAs === 'OCHL').length;
  if (ochl > 0) {
    warnings.push(`${ochl} 条数据按「开/收/高/低」顺序解析，请检查是否符合预期`);
  }

  const voteCount = new Map<string, number>();
  formatVotes.forEach((v) => voteCount.set(v, (voteCount.get(v) ?? 0) + 1));
  const formatHint = [...voteCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}（${count} 条）`)
    .join('，');

  return { bars, errors, warnings, formatHint };
}
