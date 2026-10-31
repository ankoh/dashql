import { describe, expect, it } from 'vitest';

import {
    channelSummary,
    clearChannelField,
    encodedFields,
    getMarkType,
    isBuilderEditable,
    patchChannel,
    removeChannel,
    setChannelCount,
    setChannelField,
    setChannelType,
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
        expect(isBuilderEditable({ layer: [] })).toBe(false);
        expect(isBuilderEditable({ hconcat: [] })).toBe(false);
        expect(encodedFields({ encoding: { x: { field: 'a' }, tooltip: [{ field: 'b' }, { field: 'a' }], color: { value: 'red' } } })).toEqual(['a', 'b']);
    });

    it('summarizes channels', () => {
        expect(channelSummary({ field: 'revenue', aggregate: 'sum' })).toBe('sum(revenue)');
        expect(channelSummary({ field: 'ts', timeUnit: 'month' })).toBe('month(ts)');
        expect(channelSummary({ field: 'v', bin: true })).toBe('bin(v)');
        expect(channelSummary({ value: 3 })).toBeNull();
    });
});
