import { loadVega } from './vegalite_loader.js';
import { withViewEncodings } from './vegalite_spec.js';

describe('withViewEncodings', () => {
    it('gives views without an encoding an empty one', () => {
        expect(withViewEncodings({ mark: 'line' })).toEqual({ mark: 'line', encoding: {} });
        expect(withViewEncodings({ layer: [{ mark: 'bar', encoding: { x: { field: 'a' } } }, { mark: 'line' }] })).toEqual({
            layer: [{ mark: 'bar', encoding: { x: { field: 'a' } } }, { mark: 'line', encoding: {} }],
        });
        expect(withViewEncodings({ hconcat: [{ mark: 'area' }] })).toEqual({ hconcat: [{ mark: 'area', encoding: {} }] });
        expect(withViewEncodings({ facet: { field: 'a' }, spec: { mark: 'trail' } })).toEqual({
            facet: { field: 'a' },
            spec: { mark: 'trail', encoding: {} },
        });
    });

    it('keeps specs whose views have an encoding', () => {
        const spec = { layer: [{ mark: 'line', encoding: {} }], encoding: { x: { field: 'a' } } };
        expect(withViewEncodings(spec)).toBe(spec);
        const composed = { layer: [{ mark: 'line', encoding: {} }] };
        expect(withViewEncodings(composed)).toBe(composed);
    });

    it('lets Vega-Lite compile line, area and trail marks without fields', async () => {
        const { vegaLite } = await loadVega();
        for (const mark of ['line', 'area', 'trail']) {
            const spec = withViewEncodings({ mark, data: { values: [] } }) as Parameters<typeof vegaLite.compile>[0];
            expect(() => vegaLite.compile(spec)).not.toThrow();
        }
    });
});
