import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { chartColumns, vegaLiteTypeOf } from './chart_columns.js';

describe('chart columns', () => {
    it('maps Arrow types to Vega-Lite types', () => {
        expect(vegaLiteTypeOf(new arrow.Int32())).toBe('quantitative');
        expect(vegaLiteTypeOf(new arrow.Float64())).toBe('quantitative');
        expect(vegaLiteTypeOf(new arrow.Decimal(2, 10, 128))).toBe('quantitative');
        expect(vegaLiteTypeOf(new arrow.DateDay())).toBe('temporal');
        expect(vegaLiteTypeOf(new arrow.TimestampMicrosecond())).toBe('temporal');
        expect(vegaLiteTypeOf(new arrow.Utf8())).toBe('nominal');
        expect(vegaLiteTypeOf(new arrow.Bool())).toBe('nominal');
    });

    it('lists the result columns and the encoded fields that the result lacks', () => {
        const schema = new arrow.Schema([new arrow.Field('region', new arrow.Utf8()), new arrow.Field('revenue', new arrow.Float64())]);
        expect(chartColumns(schema, ['revenue', 'gone'])).toEqual([
            { name: 'region', type: 'nominal' },
            { name: 'revenue', type: 'quantitative' },
            { name: 'gone', type: 'nominal', missing: true },
        ]);
        // Without a result, the encoded fields are listed and none is missing
        expect(chartColumns(null, ['a'])).toEqual([{ name: 'a', type: 'nominal' }]);
    });
});
