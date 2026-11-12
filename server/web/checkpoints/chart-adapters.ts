import type { Locator } from 'playwright';

/**
 * Reads the model of a chart on the page for a `checkpointChart` step
 * (docs/superpowers/specs/2026-11-12-run-comparison-design.md, "Checkpoint steps").
 *
 * A chart is pixels to the page and numbers to the library that drew it, so the numbers are
 * read from the library, in this order:
 *
 * 1. `el.__wfmChartModel()`, a hook the application may expose on the target. It is the
 *    documented contract for libraries bundled as modules, where no global instance is
 *    reachable, and it wins over everything else because the application knows best.
 * 2. DevExtreme jQuery widgets: `jQuery(el).data('dxChart' | 'dxPieChart' | 'dxPolarChart')`.
 * 3. ECharts: `echarts.getInstanceByDom(el)`.
 *
 * The target itself is tried first, then the widgets inside it, so a wrapper around a chart works
 * too. Every adapter returns the raw shape of ChartCheckpointData (shared/comparison.ts); the step
 * normalises and bounds it with chartCheckpoint (server/runtime/checkpoint.ts).
 *
 * The function runs in the page, in its main world where the libraries' globals live, so it is
 * written as plain JavaScript: nothing outside it is in scope there.
 */
export const READ_CHART_MODEL_SOURCE = String.raw`(target) => {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const x = (v) =>
    v instanceof Date ? v.toISOString() : typeof v === 'number' && Number.isFinite(v) ? v : String(v ?? '');
  const label = (v) => (v == null ? '' : typeof v === 'object' ? String(v.text ?? '') : String(v));

  const fromDevExtreme = (chart) => {
    const series = (chart.getAllSeries ? chart.getAllSeries() : []).map((s, i) => ({
      name: String(s.name ?? 'series ' + i),
      type: String(s.type ?? ''),
      points: (s.getAllPoints ? s.getAllPoints() : []).map((p) => [x(p.argument), num(p.value ?? p.originalValue)]),
    }));
    const axes = [];
    const lines = [];
    const axisOption = (key) => {
      const o = chart.option ? chart.option(key) : undefined;
      return Array.isArray(o) ? o : o ? [o] : [];
    };
    const ranges = (getter, key) => {
      let range = null;
      try { range = getter ? getter.call(chart)?.visualRange?.() ?? null : null; } catch { range = null; }
      axisOption(key).forEach((o, i) => {
        const name = label(o.title) || o.name || (key === 'argumentAxis' ? 'argument' : 'value' + (i ? i : ''));
        axes.push({
          name: String(name),
          min: num(i === 0 && range ? range.startValue : o.visualRange?.startValue ?? o.min),
          max: num(i === 0 && range ? range.endValue : o.visualRange?.endValue ?? o.max),
        });
        (o.constantLines || []).forEach((l) => {
          const value = num(l.value instanceof Date ? l.value.getTime() : l.value);
          if (value !== null) lines.push({ axis: String(name), value, label: label(l.label) });
        });
      });
    };
    ranges(chart.getArgumentAxis, 'argumentAxis');
    ranges(chart.getValueAxis, 'valueAxis');
    return { series, axes, lines };
  };

  const fromECharts = (chart) => {
    const option = chart.getOption ? chart.getOption() : {};
    const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    const xAxes = list(option.xAxis);
    const yAxes = list(option.yAxis);
    const unwrap = (v) => (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v ? v.value : v);
    const axes = [];
    const lines = [];
    xAxes.forEach((a, i) => axes.push({ name: String(a.name || 'x' + (i ? i : '')), min: num(a.min), max: num(a.max) }));
    yAxes.forEach((a, i) => axes.push({ name: String(a.name || 'y' + (i ? i : '')), min: num(a.min), max: num(a.max) }));
    const series = list(option.series).map((s, i) => {
      const categories = list((xAxes[s.xAxisIndex || 0] || {}).data).map(unwrap);
      const points = list(s.data).map((item, j) => {
        const value = unwrap(item);
        if (Array.isArray(value)) return [x(value[0]), num(value[1])];
        const name = item && typeof item === 'object' && item.name != null ? item.name : categories[j] ?? j;
        return [x(name), num(value)];
      });
      list(s.markLine && s.markLine.data).forEach((d) => {
        const one = Array.isArray(d) ? d[0] : d;
        if (!one) return;
        const axis = one.yAxis != null ? 'y' : one.xAxis != null ? 'x' : null;
        const value = num(one.yAxis ?? one.xAxis);
        if (axis && value !== null) lines.push({ axis, value, label: String(one.name ?? '') });
      });
      return { name: String(s.name ?? 'series ' + i), type: String(s.type ?? ''), points };
    });
    return { series, axes, lines };
  };

  const candidates = [target, ...target.querySelectorAll('[_echarts_instance_], .dx-widget')];
  for (const el of candidates) {
    if (typeof el.__wfmChartModel === 'function') return { adapter: 'hook', model: el.__wfmChartModel() };
  }
  const $ = window.jQuery;
  if (typeof $ === 'function') {
    for (const el of candidates) {
      for (const widget of ['dxChart', 'dxPieChart', 'dxPolarChart']) {
        const chart = $(el).data(widget);
        if (chart) return { adapter: widget, model: fromDevExtreme(chart) };
      }
    }
  }
  const echarts = window.echarts;
  if (echarts && typeof echarts.getInstanceByDom === 'function') {
    for (const el of candidates) {
      const chart = echarts.getInstanceByDom(el);
      if (chart) return { adapter: 'echarts', model: fromECharts(chart) };
    }
  }
  return { adapter: null, model: null };
}`;

/** Which adapter read the chart, or null when none recognised it. */
export type ChartAdapter = 'hook' | 'dxChart' | 'dxPieChart' | 'dxPolarChart' | 'echarts';

/** The raw model of the chart the target is (or holds); a hook that throws rejects. */
export async function readChartModel(
  target: Locator,
): Promise<{ adapter: ChartAdapter; model: unknown } | { adapter: null; model: null }> {
  // A string page function is evaluated, not called, so the source becomes a function in the page
  // first (through the debugging protocol, which a page's CSP does not block), then is called on
  // the element.
  const reader = await target.page().evaluateHandle(READ_CHART_MODEL_SOURCE);
  try {
    return (await target.evaluate(
      (el, read) => (read as unknown as (el: Element) => unknown)(el),
      reader,
    )) as { adapter: ChartAdapter; model: unknown } | { adapter: null; model: null };
  } finally {
    await reader.dispose();
  }
}
