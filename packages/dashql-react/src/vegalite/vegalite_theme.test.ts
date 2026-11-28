import { compile } from 'vega-lite';
import { describe, expect, it } from 'vitest';

import { withoutWindowResize } from './vegalite_theme.js';

describe('withoutWindowResize', () => {
    it('keeps only the container resize of a size of container', () => {
        const compiled = compile({
            width: 'container',
            height: 'container',
            data: { values: [] },
            mark: 'line',
            encoding: { x: { field: 'x', type: 'quantitative' }, y: { field: 'y', type: 'quantitative' } },
        }).spec;
        const events = (spec: typeof compiled) => (spec.signals ?? []).flatMap(signal =>
            'on' in signal && signal.on != null ? signal.on.map(update => `${signal.name} ${String(update.events)}`) : []);
        // Vega-Lite fits the size on both events
        expect(events(compiled)).toEqual(expect.arrayContaining(['width window:resize', 'width container:resize']));
        const patched = withoutWindowResize(compiled);
        expect(events(patched).filter(event => event.endsWith('window:resize'))).toEqual([]);
        expect(events(patched)).toEqual(expect.arrayContaining(['width container:resize', 'height container:resize']));
    });

    it('returns a spec without signals as it is', () => {
        const compiled = compile({ data: { values: [] }, mark: 'point', encoding: {} }).spec;
        const spec = { ...compiled, signals: undefined };
        expect(withoutWindowResize(spec)).toBe(spec);
    });
});
