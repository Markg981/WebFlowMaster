import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import type { AdhocActionId } from '@shared/recording';
import type { ChartCheckpointData } from '@shared/comparison';
import { readChartModel } from './chart-adapters';

/**
 * The adapters against stub pages: each page fakes just the library surface the adapter reads
 * (jQuery's data(), DevExtreme's getAllSeries(), ECharts' getInstanceByDom()), so the test is
 * about what is read and how it is shaped, not about the libraries themselves.
 */

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterEach(async () => {
  await page?.close();
});

afterAll(async () => {
  await browser?.close();
});

/** Each stub on its own page: setContent keeps the window, and with it the stubbed globals. */
const load = async (html: string) => {
  await page?.close();
  page = await browser.newPage();
  await page.setContent(html);
};

const HOOK_PAGE = `<div id="wrap"><div id="chart"></div></div><script>
  document.getElementById('chart').__wfmChartModel = () => ({
    series: [{ name: 'Sales', type: 'bar', points: [['Jan', 10], ['Feb', 12.5]] }],
    axes: [{ name: 'value', min: 0, max: 20 }],
    lines: [{ axis: 'value', value: 15, label: 'Target' }],
  });
</script>`;

const DEVEXTREME_PAGE = `<div id="chart" class="dx-widget"></div><script>
  const chart = {
    getAllSeries: () => [{
      name: 'Orders', type: 'line',
      getAllPoints: () => [
        { argument: new Date('2026-01-01T00:00:00Z'), value: 3 },
        { argument: new Date('2026-02-01T00:00:00Z'), value: null },
      ],
    }],
    getArgumentAxis: () => ({ visualRange: () => ({ startValue: 1, endValue: 2 }) }),
    getValueAxis: () => ({ visualRange: () => ({ startValue: 0, endValue: 10 }) }),
    option: (key) => key === 'valueAxis'
      ? { title: { text: 'Count' }, constantLines: [{ value: 5, label: { text: 'Limit' } }] }
      : key === 'argumentAxis' ? {} : undefined,
  };
  window.jQuery = (el) => ({ data: (name) => (el.id === 'chart' && name === 'dxChart' ? chart : undefined) });
</script>`;

const ECHARTS_PAGE = `<div id="outer"><div id="chart" _echarts_instance_="ec_1"></div></div><script>
  const chart = {
    getOption: () => ({
      xAxis: [{ type: 'category', data: ['Mon', { value: 'Tue' }] }],
      yAxis: [{ name: 'Visits', min: 0, max: 'dataMax' }],
      series: [
        { name: 'Visits', type: 'line', data: [120, { value: 200 }],
          markLine: { data: [{ yAxis: 150, name: 'Avg' }] } },
        { name: 'Share', type: 'pie', data: [{ name: 'A', value: 1 }, { name: 'B', value: 2 }] },
        { name: 'Scatter', type: 'scatter', data: [[1, 2], [3, 'x']] },
      ],
    }),
  };
  window.echarts = { getInstanceByDom: (el) => (el.id === 'chart' ? chart : undefined) };
</script>`;

describe('readChartModel', () => {
  it('prefers the hook the application exposes, also on an element inside the target', async () => {
    await load(HOOK_PAGE);
    expect(await readChartModel(page.locator('#chart'))).toEqual({
      adapter: 'hook',
      model: {
        series: [
          {
            name: 'Sales',
            type: 'bar',
            points: [
              ['Jan', 10],
              ['Feb', 12.5],
            ],
          },
        ],
        axes: [{ name: 'value', min: 0, max: 20 }],
        lines: [{ axis: 'value', value: 15, label: 'Target' }],
      },
    });
    // A hook on a descendant is found from a wrapper only through the widget markers, not here.
    expect((await readChartModel(page.locator('#wrap'))).adapter).toBeNull();
  });

  it('reads a DevExtreme chart: series points, visual ranges and constant lines', async () => {
    await load(DEVEXTREME_PAGE);
    const read = await readChartModel(page.locator('#chart'));
    expect(read.adapter).toBe('dxChart');
    expect(read.model).toEqual({
      series: [
        {
          name: 'Orders',
          type: 'line',
          points: [
            ['2026-01-01T00:00:00.000Z', 3],
            ['2026-02-01T00:00:00.000Z', null],
          ],
        },
      ],
      axes: [
        { name: 'argument', min: 1, max: 2 },
        { name: 'Count', min: 0, max: 10 },
      ],
      lines: [{ axis: 'Count', value: 5, label: 'Limit' }],
    });
  });

  it('reads an ECharts instance found inside the target: categories, pairs, pies, mark lines', async () => {
    await load(ECHARTS_PAGE);
    const read = await readChartModel(page.locator('#outer'));
    expect(read.adapter).toBe('echarts');
    expect(read.model).toEqual({
      series: [
        {
          name: 'Visits',
          type: 'line',
          points: [
            ['Mon', 120],
            ['Tue', 200],
          ],
        },
        {
          name: 'Share',
          type: 'pie',
          points: [
            ['A', 1],
            ['B', 2],
          ],
        },
        {
          name: 'Scatter',
          type: 'scatter',
          points: [
            [1, 2],
            [3, null],
          ],
        },
      ],
      axes: [
        { name: 'x', min: null, max: null },
        { name: 'Visits', min: 0, max: null },
      ],
      lines: [{ axis: 'y', value: 150, label: 'Avg' }],
    });
  });

  it('says so when no adapter recognises the target, and rejects when the hook throws', async () => {
    await load('<canvas id="chart"></canvas>');
    expect(await readChartModel(page.locator('#chart'))).toEqual({ adapter: null, model: null });

    await load(
      `<div id="chart"></div><script>document.getElementById('chart').__wfmChartModel = () => { throw new Error('not ready'); };</script>`,
    );
    await expect(readChartModel(page.locator('#chart'))).rejects.toThrow(/not ready/);
  });
});

describe('the checkpoint steps on a page', () => {
  const run = async (id: AdhocActionId, selector: string, value: string) => {
    const { executeStep } = await import('../step-executor');
    return executeStep(
      { page } as never,
      {
        id: `step-${id}`,
        action: { id, type: id, name: id, icon: 'x', description: id },
        targetElement: {
          id: 'e1',
          type: 'element',
          selector,
          text: '',
          tag: 'div',
          attributes: {},
        },
        value,
      } as never,
    );
  };

  it('checkpointChart passes with the normalised model, and fails when nothing is readable', async () => {
    await load(HOOK_PAGE);
    const outcome = await run('checkpointChart', '#chart', 'sales');
    expect(outcome.status).toBe('passed');
    expect(outcome.checkpoint?.kind).toBe('chart');
    expect((outcome.checkpoint?.data as ChartCheckpointData).series[0].points).toEqual([
      ['Jan', 10],
      ['Feb', 12.5],
    ]);

    await load('<canvas id="chart"></canvas>');
    const missing = await run('checkpointChart', '#chart', 'sales');
    expect(missing.status).toBe('failed');
    expect(missing.error).toMatch(/__wfmChartModel/);
  });

  it('checkpointTable reads the rows and cells the value names', async () => {
    await load(`<table id="t">
      <thead><tr><th>Id</th><th>Total</th></tr></thead>
      <tbody><tr><td>1</td><td> 12,50 </td></tr><tr><td>2</td><td>7</td></tr></tbody>
    </table>`);
    const all = await run('checkpointTable', '#t', 'orders');
    expect(all.status).toBe('passed');
    expect(all.checkpoint?.data).toEqual({
      rows: [
        ['Id', 'Total'],
        ['1', '12,50'],
        ['2', '7'],
      ],
    });

    const body = await run('checkpointTable', '#t', 'orders; rows=tbody tr; cells=td:last-child');
    expect(body.checkpoint?.data).toEqual({ rows: [['12,50'], ['7']] });

    const bad = await run('checkpointTable', '#t', 'orders; columns=td');
    expect(bad.status).toBe('failed');
  });
});
