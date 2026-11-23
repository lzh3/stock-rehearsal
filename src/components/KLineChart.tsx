import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bar } from '../core/types';
import { maColor, movingAverage } from '../core/indicators';
import { clamp, fmtPct, fmtPrice, fmtVolume } from '../core/format';
import { shortDate } from '../core/dates';

export interface KLineChartProps {
  bars: Bar[];
  forecasts: Bar[];
  maPeriods: number[];
  showVolume: boolean;
  resetSignal: number;
}

const UP = '#f6465d';
const DOWN = '#2ebd85';
const FLAT = '#8b98ab';
const GRID = 'rgba(255,255,255,0.06)';
const AXIS_TEXT = '#78849a';
const CROSS = 'rgba(210,225,255,0.45)';
const DEFAULT_VISIBLE = 120;
const MIN_VISIBLE = 10;
const AXIS_W = 58;
const PAD_T = 12;
const DATE_H = 24;
const PAD_L = 8;
const VOL_GAP = 18;
const FONT = '11px "SF Mono", Menlo, Consolas, "PingFang SC", monospace';

interface Range {
  start: number;
  end: number;
}

interface Geom {
  w: number;
  h: number;
  plotL: number;
  plotR: number;
  plotW: number;
  priceTop: number;
  priceBottom: number;
  volTop: number;
  volBottom: number;
  step: number;
  start: number;
  end: number;
}

function hexToRgba(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function niceStep(range: number, target: number): number {
  if (!(range > 0)) return 1;
  const raw = range / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return mult * mag;
}

export function KLineChart({ bars, forecasts, maPeriods, showVolume, resetSignal }: KLineChartProps) {
  const all = useMemo<Bar[]>(() => [...bars, ...forecasts], [bars, forecasts]);
  const forecastOffset = bars.length;
  const n = all.length;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; start: number; end: number } | null>(null);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<Range | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setView(null);
  }, [resetSignal]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const range = useMemo<Range>(() => {
    if (n === 0) return { start: 0, end: 0 };
    if (!view) return { start: Math.max(0, n - DEFAULT_VISIBLE), end: n - 1 };
    const start = clamp(view.start, 0, Math.max(0, n - MIN_VISIBLE));
    const end = clamp(view.end, start + MIN_VISIBLE - 1, n - 1);
    return { start, end };
  }, [view, n]);

  const geom = useMemo<Geom>(() => {
    const w = size.w;
    const h = size.h;
    const plotL = PAD_L;
    const plotR = Math.max(plotL + 20, w - AXIS_W);
    const plotW = plotR - plotL;
    const usableH = Math.max(80, h - PAD_T - DATE_H);
    const volH = showVolume ? Math.max(40, usableH * 0.22) : 0;
    const gap = showVolume ? VOL_GAP : 0;
    const priceH = Math.max(40, usableH - volH - gap);
    const priceTop = PAD_T;
    const priceBottom = priceTop + priceH;
    const volTop = priceBottom + gap;
    const volBottom = volTop + volH;
    const count = Math.max(1, range.end - range.start + 1);
    return {
      w,
      h,
      plotL,
      plotR,
      plotW,
      priceTop,
      priceBottom,
      volTop,
      volBottom,
      step: plotW / count,
      start: range.start,
      end: range.end,
    };
  }, [size, showVolume, range]);

  const maSeries = useMemo(() => {
    const closes = all.map((b) => b.close);
    const map: Record<number, (number | null)[]> = {};
    maPeriods.forEach((p) => {
      map[p] = movingAverage(closes, p);
    });
    return map;
  }, [all, maPeriods]);

  const priceScale = useMemo(() => {
    if (!n) return { lo: 0, hi: 1 };
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = range.start; i <= range.end; i += 1) {
      const b = all[i];
      if (!b) continue;
      lo = Math.min(lo, b.low);
      hi = Math.max(hi, b.high);
      maPeriods.forEach((p) => {
        const v = maSeries[p]?.[i];
        if (v != null) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      });
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1 };
    if (hi === lo) {
      const pad = Math.max(0.05, hi * 0.01);
      return { lo: lo - pad, hi: hi + pad };
    }
    const pad = (hi - lo) * 0.08;
    return { lo: lo - pad, hi: hi + pad };
  }, [all, maSeries, maPeriods, n, range]);

  const volMax = useMemo(() => {
    let m = 0;
    for (let i = range.start; i <= range.end; i += 1) {
      const b = all[i];
      if (b) m = Math.max(m, b.volume);
    }
    return m;
  }, [all, range]);

  const xFor = useCallback((i: number) => geom.plotL + (i - geom.start + 0.5) * geom.step, [geom]);
  const yPrice = useCallback(
    (p: number) => geom.priceBottom - ((p - priceScale.lo) / (priceScale.hi - priceScale.lo || 1)) * (geom.priceBottom - geom.priceTop),
    [geom, priceScale],
  );

  const hoverIndex = useMemo(() => {
    if (!cursor) return null;
    if (cursor.x < geom.plotL || cursor.x > geom.plotR) return null;
    if (cursor.y < geom.priceTop || cursor.y > geom.volBottom) return null;
    const idx = Math.floor((cursor.x - geom.plotL) / geom.step) + geom.start;
    return clamp(idx, geom.start, geom.end);
  }, [cursor, geom]);

  // ---------- 绘制 ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = geom;
    if (w <= 0 || h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.round(w * dpr);
    const pxH = Math.round(h * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!n) {
      ctx.fillStyle = AXIS_TEXT;
      ctx.font = '13px "PingFang SC", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('暂无数据，请从右侧导入历史行情', w / 2, h / 2);
      return;
    }

    const { plotL, plotR, plotW, priceTop, priceBottom, volTop, volBottom, step } = geom;

    // 网格 + 价格轴
    const pStep = niceStep(priceScale.hi - priceScale.lo, 5);
    const firstTick = Math.ceil(priceScale.lo / pStep) * pStep;
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    for (let v = firstTick; v <= priceScale.hi + 1e-9; v += pStep) {
      const y = Math.round(yPrice(v)) + 0.5;
      if (y < priceTop - 1 || y > priceBottom + 1) continue;
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotL, y);
      ctx.lineTo(plotR, y);
      ctx.stroke();
      ctx.fillStyle = AXIS_TEXT;
      ctx.textAlign = 'left';
      ctx.fillText(v.toFixed(2), plotR + 6, y);
    }

    // 预演区域
    if (forecasts.length) {
      const boundary = plotL + (forecastOffset - geom.start) * step;
      if (boundary < plotR && boundary > plotL - step) {
        ctx.fillStyle = 'rgba(76,141,255,0.07)';
        ctx.fillRect(Math.max(plotL, boundary), priceTop, plotR - Math.max(plotL, boundary), volBottom - priceTop);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(76,141,255,0.5)';
        ctx.beginPath();
        ctx.moveTo(boundary, priceTop);
        ctx.lineTo(boundary, volBottom);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#5f9bff';
        ctx.font = FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('预演 →', Math.max(plotL + 2, boundary + 5), priceTop + 2);
      }
    }

    // 日期轴
    const count = geom.end - geom.start + 1;
    const labelEvery = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(plotW / 74))));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = geom.start; i <= geom.end; i += labelEvery) {
      const x = Math.round(xFor(i)) + 0.5;
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(x, priceTop);
      ctx.lineTo(x, volBottom);
      ctx.stroke();
      ctx.fillStyle = AXIS_TEXT;
      ctx.fillText(shortDate(all[i].date), x, volBottom + 6);
    }

    // K 线
    const bodyW = Math.max(1, Math.min(step * 0.68, 18));
    for (let i = geom.start; i <= geom.end; i += 1) {
      const b = all[i];
      const x = xFor(i);
      const isUp = b.close > b.open;
      const isFlat = b.close === b.open;
      const color = isFlat ? FLAT : isUp ? UP : DOWN;
      const isForecast = i >= forecastOffset;
      const xc = Math.round(x) + 0.5;

      if (step >= 2.5) {
        ctx.strokeStyle = isForecast ? hexToRgba(color, 0.85) : color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xc, yPrice(b.high));
        ctx.lineTo(xc, yPrice(b.low));
        ctx.stroke();
      }

      const yTop = yPrice(Math.max(b.open, b.close));
      const yBot = yPrice(Math.min(b.open, b.close));
      const bh = Math.max(1, yBot - yTop);
      const bw = Math.max(1, Math.round(bodyW));
      const bx = Math.round(xc - bw / 2);

      if (step < 2.5) {
        ctx.strokeStyle = isForecast ? hexToRgba(color, 0.85) : color;
        ctx.beginPath();
        ctx.moveTo(xc, yPrice(b.high));
        ctx.lineTo(xc, yPrice(b.low));
        ctx.stroke();
      } else if (isForecast) {
        ctx.fillStyle = hexToRgba(color, 0.3);
        ctx.fillRect(bx, yTop, bw, bh);
        ctx.save();
        ctx.setLineDash([3, 2]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, yTop + 0.5, Math.max(1, bw - 1), Math.max(1, bh - 1));
        ctx.restore();
      } else if (isFlat) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx, Math.round(yTop) + 0.5);
        ctx.lineTo(bx + bw, Math.round(yTop) + 0.5);
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(bx, yTop, bw, bh);
        if (bh > 3) {
          ctx.fillStyle = 'rgba(0,0,0,0.16)';
          ctx.fillRect(bx, yTop + 1, bw, 1);
        }
      }
    }

    // 均线
    maPeriods.forEach((p) => {
      const series = maSeries[p];
      if (!series) return;
      ctx.strokeStyle = maColor(p);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      let started = false;
      for (let i = geom.start; i <= geom.end; i += 1) {
        const v = series[i];
        if (v == null) {
          started = false;
          continue;
        }
        const x = xFor(i);
        const y = yPrice(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    });

    // 成交量
    if (showVolume) {
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(plotL, Math.round(volTop) + 0.5);
      ctx.lineTo(plotR, Math.round(volTop) + 0.5);
      ctx.stroke();
      const vh = volBottom - volTop;
      const max = volMax || 1;
      for (let i = geom.start; i <= geom.end; i += 1) {
        const b = all[i];
        if (!b.volume) continue;
        const isFlat = b.close === b.open;
        const color = isFlat ? FLAT : b.close > b.open ? UP : DOWN;
        const barH = Math.max(1, (b.volume / max) * (vh - 4));
        const bw = Math.max(1, Math.round(bodyW));
        const xc = Math.round(xFor(i)) + 0.5;
        ctx.fillStyle = i >= forecastOffset ? hexToRgba(color, 0.45) : hexToRgba(color, 0.7);
        ctx.fillRect(Math.round(xc - bw / 2), volBottom - barH, bw, barH);
      }
      ctx.fillStyle = AXIS_TEXT;
      ctx.font = FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`VOL ${fmtVolume(volMax)}`, plotL + 2, volTop + 2);
      ctx.textAlign = 'left';
      ctx.fillText(fmtVolume(volMax / 2), plotR + 6, volTop + vh / 2 - 6);
    }

    // 十字光标
    if (hoverIndex != null && cursor) {
      const b = all[hoverIndex];
      const x = Math.round(xFor(hoverIndex)) + 0.5;
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = CROSS;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, priceTop);
      ctx.lineTo(x, volBottom);
      ctx.stroke();
      if (cursor.y >= priceTop && cursor.y <= priceBottom) {
        const y = Math.round(cursor.y) + 0.5;
        ctx.beginPath();
        ctx.moveTo(plotL, y);
        ctx.lineTo(plotR, y);
        ctx.stroke();
        ctx.restore();
        const price = priceScale.lo + ((priceBottom - cursor.y) / (priceBottom - priceTop)) * (priceScale.hi - priceScale.lo);
        const label = price.toFixed(2);
        ctx.font = FONT;
        const tw = ctx.measureText(label).width + 12;
        ctx.fillStyle = '#2a3346';
        ctx.fillRect(plotR + 2, y - 8, Math.max(tw, AXIS_W - 6), 16);
        ctx.fillStyle = '#dbe6f7';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, plotR + 8, y);
      } else {
        ctx.restore();
      }
      // 日期标签
      const dateText = b.date;
      ctx.font = FONT;
      const dw = ctx.measureText(dateText).width + 14;
      const dx = clamp(x - dw / 2, plotL, plotR - dw);
      ctx.fillStyle = '#2a3346';
      ctx.fillRect(dx, volBottom + 3, dw, 16);
      ctx.fillStyle = '#dbe6f7';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dateText, dx + dw / 2, volBottom + 11);
    }
  }, [
    all,
    cursor,
    forecastOffset,
    forecasts.length,
    geom,
    hoverIndex,
    maPeriods,
    maSeries,
    n,
    priceScale,
    showVolume,
    volMax,
    xFor,
    yPrice,
  ]);

  // ---------- 交互 ----------
  const clampRange = useCallback(
    (start: number, end: number): Range => {
      const count = Math.max(MIN_VISIBLE, end - start + 1);
      const s = clamp(start, 0, Math.max(0, n - count));
      return { start: s, end: Math.min(n - 1, s + count - 1) };
    },
    [n],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !n) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frac = clamp((x - geom.plotL) / geom.plotW, 0, 1);
      const anchor = geom.start + frac * (geom.end - geom.start + 1);
      const visible = geom.end - geom.start + 1;
      const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      const nextCount = Math.round(clamp(visible * factor, MIN_VISIBLE, Math.max(MIN_VISIBLE, n)));
      const nextStart = Math.round(anchor - frac * nextCount);
      setView(clampRange(nextStart, nextStart + nextCount - 1));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [clampRange, geom, n]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, start: geom.start, end: geom.end };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const shift = Math.round(-dx / geom.step);
    if (shift !== 0) setView(clampRange(drag.start + shift, drag.end + shift));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const displayIndex = hoverIndex ?? (n ? geom.end : null);
  const displayBar = displayIndex != null ? all[displayIndex] : null;
  const prevBar = displayIndex != null && displayIndex > 0 ? all[displayIndex - 1] : null;
  const changePct = displayBar ? ((displayBar.close - (prevBar?.close ?? displayBar.open)) / (prevBar?.close ?? displayBar.open)) * 100 : 0;
  const displayIsForecast = displayIndex != null && displayIndex >= forecastOffset;

  return (
    <div className="kchart" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="kchart-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          setCursor(null);
          dragRef.current = null;
        }}
      />
      {displayBar && (
        <div className="kchart-legend">
          <div className="legend-row">
            <span className="legend-date">
              {displayBar.date}
              {displayIsForecast && <em className="legend-badge">预演</em>}
            </span>
            <span>
              开 <b style={{ color: displayBar.close >= displayBar.open ? UP : DOWN }}>{fmtPrice(displayBar.open)}</b>
            </span>
            <span>
              高 <b style={{ color: UP }}>{fmtPrice(displayBar.high)}</b>
            </span>
            <span>
              低 <b style={{ color: DOWN }}>{fmtPrice(displayBar.low)}</b>
            </span>
            <span>
              收 <b style={{ color: displayBar.close >= displayBar.open ? UP : DOWN }}>{fmtPrice(displayBar.close)}</b>
            </span>
            <span>
              涨跌 <b style={{ color: changePct >= 0 ? UP : DOWN }}>{fmtPct(changePct)}</b>
            </span>
            <span className="legend-dim">量 {fmtVolume(displayBar.volume)}</span>
          </div>
          {maPeriods.length > 0 && (
            <div className="legend-row legend-ma">
              {maPeriods.map((p) => (
                <span key={p} style={{ color: maColor(p) }}>
                  MA{p} {fmtPrice(displayIndex != null ? maSeries[p]?.[displayIndex] ?? null : null)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
