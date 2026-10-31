import { describe, expect, it } from 'vitest';

import {
    addColumnLayer,
    addLayer,
    channelSummary,
    clearChannelField,
    encodedFields,
    getLayer,
    getMarkType,
    isBuilderEditable,
    layerCount,
    newLayerView,
    patchChannel,
    removeChannel,
    removeLayer,
    setChannelCount,
    setChannelField,
    setChannelType,
    setLayer,
    setMarkType,
    setTopLevel,
} from './chart_spec_paths.js';

describe('chart spec paths', () => {
    it('sets the mark and keeps the properties of a mark object', () => {
        expect(setMarkType({ mark: 'bar' }, 'line')).toEqual({ mark: 'line' });
        expect(setMarkType({ mark: { type: 'bar', tooltip: true } }, 'point')).toEqual({ mark: { type: 'point', tooltip: true } });
        expect(getMarkType({ mark: { type: 'area' } })).toBe('area');
        expect(getMarkType({})).toBeNull();
    });

    it('encodes a field and keeps the keys that the builder does not own', () => {
        const spec = {
            mark: 'bar',
            transform: [{ filter: 'datum.x > 0' }],
            encoding: { x: { field: 'a', type: 'nominal', axis: { labelAngle: 45 } } },
        };
        const next = setChannelField(spec, 'x', 'b', 'quantitative');
        expect(next).toEqual({
            mark: 'bar',
            transform: [{ filter: 'datum.x > 0' }],
            encoding: { x: { field: 'b', type: 'quantitative', axis: { labelAngle: 45 } } },
        });
        // The input is not changed
        expect(spec.encoding.x.field).toBe('a');
    });

    it('drops the properties that do not fit a new type', () => {
        const spec = { encoding: { x: { field: 'ts', type: 'temporal', timeUnit: 'month', scale: { zero: false } } } };
        expect(setChannelType(spec, 'x', 'nominal')).toEqual({ encoding: { x: { field: 'ts', type: 'nominal', scale: { zero: false } } } });
        expect(setChannelField({ encoding: { y: { field: 'v', type: 'quantitative', bin: true } } }, 'y', 'name', 'nominal'))
            .toEqual({ encoding: { y: { field: 'name', type: 'nominal' } } });
    });

    it('encodes a count without a field', () => {
        const spec = setChannelCount({ encoding: { y: { field: 'v', type: 'nominal', title: 'Rows' } } }, 'y');
        expect(spec).toEqual({ encoding: { y: { aggregate: 'count', type: 'quantitative', title: 'Rows' } } });
        expect(channelSummary((spec.encoding as Record<string, unknown>).y)).toBe('count()');
        // A field replaces the count
        expect(setChannelField(spec, 'y', 'v', 'quantitative')).toEqual({ encoding: { y: { field: 'v', type: 'quantitative', title: 'Rows' } } });
    });

    it('clears a field, keeps foreign keys and removes empty channels and encodings', () => {
        const spec = { mark: 'bar', encoding: { x: { field: 'a', type: 'nominal', sort: 'ascending', axis: null }, y: { field: 'b', type: 'quantitative' } } };
        const cleared = clearChannelField(spec, 'x');
        expect(cleared).toEqual({ mark: 'bar', encoding: { x: { axis: null }, y: { field: 'b', type: 'quantitative' } } });
        expect(clearChannelField({ mark: 'bar', encoding: { y: { field: 'b', type: 'quantitative' } } }, 'y')).toEqual({ mark: 'bar' });
        expect(removeChannel(cleared, 'x')).toEqual({ mark: 'bar', encoding: { y: { field: 'b', type: 'quantitative' } } });
    });

    it('patches and removes channel properties', () => {
        const spec = { encoding: { color: { field: 'c', type: 'nominal' } } };
        expect(patchChannel(spec, 'color', { aggregate: 'sum' })).toEqual({ encoding: { color: { field: 'c', type: 'nominal', aggregate: 'sum' } } });
        expect(patchChannel(spec, 'color', { field: undefined, type: undefined })).toEqual({});
        expect(patchChannel({ encoding: { x: { field: 'a' } } }, 'x', { stack: null })).toEqual({ encoding: { x: { field: 'a', stack: null } } });
    });

    it('sets and removes top-level properties', () => {
        expect(setTopLevel({ mark: 'bar' }, 'width', 300)).toEqual({ mark: 'bar', width: 300 });
        expect(setTopLevel({ mark: 'bar', title: 'Sales' }, 'title', undefined)).toEqual({ mark: 'bar' });
    });

    it('detects composed views and lists the encoded fields', () => {
        expect(isBuilderEditable({ mark: 'bar' })).toBe(true);
        expect(isBuilderEditable({ hconcat: [] })).toBe(false);
        expect(isBuilderEditable({ facet: { row: { field: 'a' } }, spec: { mark: 'bar' } })).toBe(false);
        expect(encodedFields({ encoding: { x: { field: 'a' }, tooltip: [{ field: 'b' }, { field: 'a' }], color: { value: 'red' } } })).toEqual(['a', 'b']);
        expect(encodedFields({ layer: [{ encoding: { x: { field: 'a' } } }, { encoding: { y: { field: 'b' } } }] })).toEqual(['a', 'b']);
    });

    it('edits layers of single views', () => {
        expect(isBuilderEditable({ layer: [{ mark: 'bar' }, { mark: 'rule' }], title: 't' })).toBe(true);
        // No layers, nested compositions and an encoding that the layers share are edited as JSON
        expect(isBuilderEditable({ layer: [] })).toBe(false);
        expect(isBuilderEditable({ layer: [{ layer: [{ mark: 'bar' }] }] })).toBe(false);
        expect(isBuilderEditable({ layer: [{ mark: 'bar' }], encoding: { x: { field: 'a' } } })).toBe(false);

        const layered = { title: 't', layer: [{ mark: 'bar' }, { mark: 'rule' }] };
        expect(layerCount(layered)).toBe(2);
        expect(getLayer(layered, 1)).toEqual({ mark: 'rule' });
        expect(setLayer(layered, 1, { mark: 'line' })).toEqual({ title: 't', layer: [{ mark: 'bar' }, { mark: 'line' }] });
        // A single view is its only layer
        expect(layerCount({ mark: 'bar' })).toBe(1);
        expect(getLayer({ mark: 'bar' }, 0)).toEqual({ mark: 'bar' });
        expect(setLayer({ mark: 'bar' }, 0, { mark: 'line' })).toEqual({ mark: 'line' });
    });

    it('moves the mark and the encoding of a single view into the first layer', () => {
        const single = {
            title: 'Revenue',
            width: 300,
            transform: [{ filter: 'datum.revenue > 0' }],
            mark: { type: 'bar', tooltip: true },
            encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' } },
        };
        const layered = addLayer(single, { mark: 'rule' });
        expect(layered).toEqual({
            title: 'Revenue',
            width: 300,
            transform: [{ filter: 'datum.revenue > 0' }],
            layer: [{ mark: single.mark, encoding: single.encoding }, { mark: 'rule' }],
        });
        expect(addLayer(layered, { mark: 'text' }).layer).toHaveLength(3);

        // Removing down to one layer restores the single view
        expect(removeLayer(layered, 1)).toEqual(single);
        // A layer whose keys clash with the keys on top stays a layer
        const clash = { transform: [{ filter: 'true' }], layer: [{ mark: 'bar', transform: [] }, { mark: 'rule' }] };
        expect(removeLayer(clash, 1)).toEqual({ transform: [{ filter: 'true' }], layer: [{ mark: 'bar', transform: [] }] });
        // The last layer is not removed
        expect(removeLayer({ layer: [{ mark: 'bar' }] }, 0)).toEqual({ layer: [{ mark: 'bar' }] });
    });

    it('shares x with a new layer and aggregates a dropped measure like the layer', () => {
        const bars = {
            mark: 'bar',
            encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' } },
        };
        expect(newLayerView(bars, { field: 'cost', type: 'quantitative' })).toEqual({
            mark: 'line',
            encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'cost', type: 'quantitative', aggregate: 'sum' } },
        });
        // A dimension is not aggregated, a count is no aggregate of a field
        expect(newLayerView(bars, { field: 'segment', type: 'nominal' }).encoding).toMatchObject({ y: { field: 'segment', type: 'nominal' } });
        expect(newLayerView({ encoding: { y: { aggregate: 'count', type: 'quantitative' } } }, { field: 'cost', type: 'quantitative' }))
            .toEqual({ mark: 'line', encoding: { y: { field: 'cost', type: 'quantitative' } } });
        // Without a column, the new layer only shares x
        expect(newLayerView(bars)).toEqual({ mark: 'line', encoding: { x: { field: 'region', type: 'nominal' } } });
        expect(newLayerView({ mark: 'bar' })).toEqual({ mark: 'line' });
    });

    it('tells the layers of a dropped column apart by a color datum', () => {
        const x = { field: 'region', type: 'nominal' };
        const bars = { title: 't', mark: 'bar', encoding: { x, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' } } };
        const layered = addColumnLayer(bars, 0, { field: 'cost', type: 'quantitative' });
        expect(layered).toEqual({
            title: 't',
            layer: [
                { mark: 'bar', encoding: { ...bars.encoding, color: { datum: 'sum(revenue)' } } },
                { mark: 'line', encoding: { x, y: { field: 'cost', type: 'quantitative', aggregate: 'sum' }, color: { datum: 'sum(cost)' } } },
            ],
        });
        // A layer with a color keeps it, the new layer shares x with the selected layer
        const colored = { layer: [{ mark: 'bar', encoding: { x, color: { field: 'segment', type: 'nominal' } } }, { mark: 'rule' }] };
        expect(addColumnLayer(colored, 0, { field: 'cost', type: 'quantitative' }).layer).toEqual([
            colored.layer[0],
            { mark: 'rule' },
            { mark: 'line', encoding: { x, y: { field: 'cost', type: 'quantitative' }, color: { datum: 'cost' } } },
        ]);
    });

    it('summarizes channels', () => {
        expect(channelSummary({ field: 'revenue', aggregate: 'sum' })).toBe('sum(revenue)');
        expect(channelSummary({ field: 'ts', timeUnit: 'month' })).toBe('month(ts)');
        expect(channelSummary({ field: 'v', bin: true })).toBe('bin(v)');
        expect(channelSummary({ value: 3 })).toBeNull();
    });
});
