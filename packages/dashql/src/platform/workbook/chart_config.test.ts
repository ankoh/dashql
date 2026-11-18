import * as vegaLite from 'vega-lite';

import { chartSpecProblems, compileProblems, createChartConfig, LIGHT_CHART_COLORS, withViewEncodings, type VegaLiteCompile } from './chart_config.js';

const compile = vegaLite.compile as unknown as VegaLiteCompile;

describe('the charts of scripts', () => {
    it('finds no problems in a chart whose fields are columns of the result', () => {
        const spec = { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } };
        expect(compileProblems(compile, spec)).toEqual([]);
        expect(chartSpecProblems(spec, ['region', 'revenue'])).toEqual([]);
        // Without a result only the sizes are checked
        expect(chartSpecProblems(spec, null)).toEqual([]);
    });

    it('names the fields that the result lacks, also in layers and conditions', () => {
        const spec = {
            layer: [
                { mark: 'line', encoding: { x: { field: 'day', type: 'temporal' }, y: { field: 'total', type: 'quantitative' } } },
                { mark: 'point', encoding: { color: { condition: { param: 'p', field: 'region' }, value: 'grey' } } },
            ],
        };
        expect(chartSpecProblems(spec, ['day', 'amount'])).toEqual([
            'the field "total" is no column of the result, its columns are day, amount',
            'the field "region" is no column of the result, its columns are day, amount',
        ]);
    });

    it('takes the fields that transforms make and the nested fields of a column', () => {
        const spec = {
            transform: [{ calculate: 'datum.amount * 2', as: 'double' }, { aggregate: [{ op: 'sum', field: 'amount', as: 'sum_amount' }], groupby: ['region'] }],
            mark: 'bar',
            encoding: { x: { field: 'region' }, y: { field: 'sum_amount' }, color: { field: 'double' }, tooltip: [{ field: 'address.city' }] },
        };
        expect(chartSpecProblems(spec, ['region', 'amount', 'address'])).toEqual([]);
    });

    it('leaves the size to DashQL', () => {
        const spec = { mark: 'bar', width: 400, autosize: 'fit', encoding: {} };
        expect(chartSpecProblems(spec, [])).toEqual(['leave the size to DashQL, it fits every chart to its card: remove width, autosize']);
    });

    it('reports what Vega-Lite does not compile', () => {
        expect(compileProblems(compile, { mark: 'bar', encoding: { x: { field: 'a', type: 'nominal', aggregate: 'nope' } } })).not.toEqual([]);
        expect(compileProblems(compile, { mark: 'nope' }).length).toBeGreaterThan(0);
    });

    it('themes the charts and gives views without an encoding one', () => {
        expect(createChartConfig(LIGHT_CHART_COLORS, 'Instrument Sans').font).toBe('Instrument Sans');
        expect(withViewEncodings({ layer: [{ mark: 'line' }] })).toEqual({ layer: [{ mark: 'line', encoding: {} }] });
    });
});
