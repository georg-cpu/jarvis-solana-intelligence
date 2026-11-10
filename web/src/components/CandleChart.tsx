import { createChart, CrosshairMode, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { Candle, TradePlan } from "../../../shared/types";

export function CandleChart({ candles, plan, height = 320 }: { candles: Candle[]; plan?: TradePlan | null; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const linesRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height,
      layout: { background: { color: "transparent" }, textColor: "#94a3b8", fontFamily: "JetBrains Mono, monospace", fontSize: 10 },
      grid: { vertLines: { color: "rgba(54,64,74,.25)" }, horzLines: { color: "rgba(54,64,74,.25)" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "rgba(34,211,238,.4)" }, horzLine: { color: "rgba(34,211,238,.4)" } },
      rightPriceScale: { borderColor: "#262d35" },
      timeScale: { borderColor: "#262d35", timeVisible: true, secondsVisible: false },
      autoSize: true,
    });
    const series = chart.addCandlestickSeries({
      upColor: "#10b981", downColor: "#f43f5e", borderUpColor: "#10b981", borderDownColor: "#f43f5e", wickUpColor: "#10b981", wickDownColor: "#f43f5e",
      priceFormat: { type: "custom", minMove: 1e-12, formatter: (p: number) => (p >= 1 ? p.toFixed(4) : p.toPrecision(4)) },
    });
    const vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, color: "rgba(34,211,238,.25)" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart; seriesRef.current = series; volRef.current = vol;
    return () => { chart.remove(); chartRef.current = null; };
  }, [height]);

  useEffect(() => {
    const s = seriesRef.current, v = volRef.current;
    if (!s || !v) return;
    s.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    v.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "rgba(16,185,129,.28)" : "rgba(244,63,94,.28)" })));
    for (const l of linesRef.current) s.removePriceLine(l);
    linesRef.current = [];
    if (plan?.available && plan.entryZone && plan.stopLoss) {
      const add = (price: number, color: string, title: string, style = 2) => linesRef.current.push(s.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
      add(plan.entryZone[0], "#22d3ee", "entry lo");
      add(plan.entryZone[1], "#22d3ee", "entry hi");
      add(plan.stopLoss, "#f43f5e", "stop (hyp.)", 0);
      for (const tp of plan.takeProfits ?? []) add(tp.price, "#10b981", tp.label);
    }
    chartRef.current?.timeScale().fitContent();
  }, [candles, plan]);

  return <div ref={ref} className="w-full" style={{ height }} />;
}
