import type { Board } from './types';
import { limitPrices } from './limit';
import { fmtPct, fmtPrice, round2 } from './format';

export interface ForecastDay {
  /** 1 开始，表示预演的第几个交易日 */
  index: number;
  raw: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tags: string[];
  note: string;
  warnings: string[];
}

export interface ForecastParseResult {
  days: ForecastDay[];
  errors: Array<{ line: number; raw: string; message: string }>;
}

const SEPARATORS = /[\s,;|，、；]+/;
const EPS = 1e-6;

const VOLUME_MULT: Record<string, number> = {
  地量: 0.3,
  缩量: 0.6,
  量平: 1,
  量不变: 1,
  放量: 1.8,
  巨量: 2.5,
  天量: 3,
};

interface DayIntent {
  openPrice: number | null;
  closePrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  volumeMult: number | null;
  tags: string[];
  notes: string[];
  warnings: string[];
}

function emptyIntent(): DayIntent {
  return {
    openPrice: null,
    closePrice: null,
    highPrice: null,
    lowPrice: null,
    volumeMult: null,
    tags: [],
    notes: [],
    warnings: [],
  };
}

function samePrice(a: number | null, b: number): boolean {
  return a != null && Math.abs(a - b) < EPS;
}

/** 解析单行关键词，产出「意图」，实际价格在拿到前收后计算 */
function parseLine(
  line: string,
  prevClose: number,
  limitUp: number,
  limitDown: number,
): DayIntent {
  const intent = emptyIntent();

  for (const rawTok of line.split(SEPARATORS).filter(Boolean)) {
    const t = rawTok.replace(/[％]/g, '%').trim();
    if (!t) continue;

    // 一字板
    const yiZi = /^一字(涨停|跌停)$/.exec(t);
    if (yiZi) {
      const target = yiZi[1] === '涨停' ? limitUp : limitDown;
      intent.openPrice = target;
      intent.closePrice = target;
      intent.highPrice = target;
      intent.lowPrice = target;
      intent.tags.push(yiZi[1], '一字');
      intent.notes.push(`一字${yiZi[1]}`);
      continue;
    }

    if (t === '涨停' || t === '停板') {
      intent.closePrice = limitUp;
      intent.tags.push('涨停');
      intent.notes.push('涨停');
      continue;
    }
    if (t === '跌停') {
      intent.closePrice = limitDown;
      intent.tags.push('跌停');
      intent.notes.push('跌停');
      continue;
    }

    // 开盘
    if (/^(平开|开平|开盘平)$/.test(t)) {
      intent.openPrice = prevClose;
      intent.tags.push('平开');
      intent.notes.push('平开');
      continue;
    }
    const openMatch = /^(开|开盘|高开|低开|低开高走|高开低走)([+-]?\d+(?:\.\d+)?)%?$/.exec(t);
    if (openMatch) {
      const pct = Number(openMatch[2]);
      intent.openPrice = round2(prevClose * (1 + pct / 100));
      const dir = openMatch[1].startsWith('低') ? '低开' : openMatch[1].startsWith('高') ? '高开' : '开';
      const label = `${dir}${fmtPct(pct)}`;
      intent.tags.push(label);
      intent.notes.push(label);
      continue;
    }

    // 收盘
    const closePctMatch = /^收(?:盘)?([+-]\d+(?:\.\d+)?)(%?)$/.exec(t);
    if (closePctMatch && closePctMatch[2] === '%') {
      const pct = Number(closePctMatch[1]);
      intent.closePrice = round2(prevClose * (1 + pct / 100));
      intent.tags.push(`收${fmtPct(pct)}`);
      intent.notes.push(`收${fmtPct(pct)}`);
      continue;
    }
    const closePriceMatch = /^收(?:盘)?[=:：]?(\d+(?:\.\d+)?)$/.exec(t);
    if (closePriceMatch && /[=:：]/.test(t)) {
      intent.closePrice = Number(closePriceMatch[1]);
      intent.tags.push(`收=${fmtPrice(intent.closePrice)}`);
      intent.notes.push(`收=${fmtPrice(intent.closePrice)}`);
      continue;
    }

    // 最高 / 最低
    const hlPctMatch = /^(最高|最低)([+-]\d+(?:\.\d+)?)%$/.exec(t);
    if (hlPctMatch) {
      const pct = Number(hlPctMatch[2]);
      const price = round2(prevClose * (1 + pct / 100));
      if (hlPctMatch[1] === '最高') intent.highPrice = price;
      else intent.lowPrice = price;
      intent.tags.push(`${hlPctMatch[1]}${fmtPct(pct)}`);
      continue;
    }
    const hlPriceMatch = /^(最高|最低)[=:：](\d+(?:\.\d+)?)$/.exec(t);
    if (hlPriceMatch) {
      const price = Number(hlPriceMatch[2]);
      if (hlPriceMatch[1] === '最高') intent.highPrice = price;
      else intent.lowPrice = price;
      intent.tags.push(`${hlPriceMatch[1]}=${fmtPrice(price)}`);
      continue;
    }

    // 成交量
    if (VOLUME_MULT[t] !== undefined) {
      intent.volumeMult = VOLUME_MULT[t];
      intent.tags.push(t);
      intent.notes.push(`量×${VOLUME_MULT[t]}`);
      continue;
    }
    const volPriceMatch = /^量[=:：](\d+(?:\.\d+)?)$/.exec(t);
    if (volPriceMatch) {
      intent.volumeMult = null;
      intent.tags.push(`量=${volPriceMatch[1]}`);
      intent.notes.push(`量=${volPriceMatch[1]}`);
      continue;
    }
    const volPctMatch = /^量([+-]\d+(?:\.\d+)?)%$/.exec(t);
    if (volPctMatch) {
      const mult = 1 + Number(volPctMatch[1]) / 100;
      intent.volumeMult = mult;
      intent.tags.push(`量${fmtPct(Number(volPctMatch[1]))}`);
      intent.notes.push(`量${fmtPct(Number(volPctMatch[1]))}`);
      continue;
    }

    intent.warnings.push(`未识别关键词「${t}」，已忽略`);
  }

  // 若只写了「涨停」而没有开盘信息 —— 默认按平开处理（非一字板）
  if (samePrice(intent.closePrice, limitUp) && intent.openPrice == null) {
    intent.openPrice = prevClose;
    intent.notes.push('默认平开');
  }
  if (samePrice(intent.closePrice, limitDown) && intent.openPrice == null) {
    intent.openPrice = prevClose;
    intent.notes.push('默认平开');
  }

  return intent;
}

/**
 * 解析预演文本：每行 = 一个交易日，行内可写多个关键词。
 *
 * 常用关键词：
 *   涨停 / 跌停 / 一字涨停 / 一字跌停
 *   平开 / 开+2% / 高开2% / 低开3%
 *   收+5% / 收-3% / 收=12.66
 *   最高+4% / 最低-2% / 最高=12.80 / 最低=11.90
 *   缩量 / 放量 / 巨量 / 天量 / 地量 / 量平 / 量+30%
 *
 * 默认值：开盘 = 前收；高/低 = max/min(开, 收)；价格全部夹在本板块涨跌停区间内。
 */
export function parseForecastKeywords(
  text: string,
  baseClose: number,
  baseVolume: number,
  board: Board,
): ForecastParseResult {
  const errors: ForecastParseResult['errors'] = [];
  const days: ForecastDay[] = [];

  let prevClose = baseClose;
  let prevVolume = baseVolume;
  let index = 0;

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine
      .replace(/[，、；]/g, ',')
      .replace(/：/g, ':')
      .trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;

    if (!(prevClose > 0)) {
      errors.push({ line: i + 1, raw: rawLine, message: '缺少基准收盘价，无法推演' });
      return;
    }

    index += 1;
    const { up: limitUp, down: limitDown } = limitPrices(prevClose, board);
    const intent = parseLine(line, prevClose, limitUp, limitDown);
    const warnings = [...intent.warnings];

    const open = round2(intent.openPrice ?? prevClose);
    const close = round2(intent.closePrice ?? open);
    let high = round2(intent.highPrice ?? Math.max(open, close));
    let low = round2(intent.lowPrice ?? Math.min(open, close));

    const clampTo = (v: number, lo: number, hi: number, name: string): number => {
      if (v > hi + EPS) {
        warnings.push(`${name} ${fmtPrice(v)} 超过涨停价，已压到 ${fmtPrice(hi)}`);
        return hi;
      }
      if (v < lo - EPS) {
        warnings.push(`${name} ${fmtPrice(v)} 低于跌停价，已抬到 ${fmtPrice(lo)}`);
        return lo;
      }
      return v;
    };

    const clampedOpen = clampTo(open, limitDown, limitUp, '开盘价');
    const clampedClose = clampTo(close, limitDown, limitUp, '收盘价');
    high = Math.max(high, clampedOpen, clampedClose);
    low = Math.min(low, clampedOpen, clampedClose);
    high = clampTo(high, limitDown, limitUp, '最高价');
    low = clampTo(low, limitDown, limitUp, '最低价');

    const volume = intent.volumeMult != null && prevVolume > 0 ? Math.round(prevVolume * intent.volumeMult) : prevVolume > 0 ? prevVolume : 0;

    const tags = [...intent.tags];
    if (Math.abs(clampedClose - limitUp) < EPS && !tags.includes('涨停')) tags.push('涨停');
    if (Math.abs(clampedClose - limitDown) < EPS && !tags.includes('跌停')) tags.push('跌停');

    const day: ForecastDay = {
      index,
      raw: line,
      open: clampedOpen,
      high,
      low,
      close: clampedClose,
      volume,
      tags,
      note: intent.notes.join('，'),
      warnings,
    };
    days.push(day);

    prevClose = clampedClose;
    prevVolume = volume;
  });

  return { days, errors };
}

/** 关键词提示，供 UI 里做“点一下就插入”的快捷按钮 */
export const KEYWORD_HINTS: string[] = [
  '涨停',
  '一字涨停',
  '跌停',
  '一字跌停',
  '平开',
  '高开3%',
  '低开2%',
  '收+5%',
  '收-3%',
  '最高+4%',
  '最低-2%',
  '放量',
  '缩量',
  '巨量',
  '地量',
  '量平',
];
