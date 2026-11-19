import { describe, expect, it, vi } from 'vitest';

import { detectFormats, detectStructuredFormats, structuredValueToText } from './cell_detail_overlay.js';

describe('result cell formats', () => {
    it('reads plans and JSON documents without asking for SQL', () => {
        const detectSql = vi.fn(() => ({ hasErrors: false, formattedText: null }));
        const plan = '{"tree":{"operator":"result-sink","operator-id":1,"inputs":[]}}';
        const formats = detectFormats(plan, detectSql);
        expect(formats.plan).toBe(plan);
        expect(formats.json).toEqual({ tree: { operator: 'result-sink', 'operator-id': 1, inputs: [] } });
        expect(formats.sql).toBeNull();

        expect(detectFormats('[1, 2, 3]', detectSql).sql).toBeNull();
        expect(detectSql).not.toHaveBeenCalled();
    });

    it('reads other values as SQL once the host can', () => {
        expect(detectFormats('select 1', null).sql).toBeNull();
        expect(detectFormats('select 1', () => ({ hasErrors: false, formattedText: 'SELECT 1' })).sql)
            .toEqual({ hasErrors: false, formattedText: 'SELECT 1', originalText: 'select 1' });
        expect(detectFormats('not sql', () => null).sql).toBeNull();
    });
});

describe('result cell structured formatting', () => {
    it('exposes Arrow list values only through the JSON viewer', () => {
        const value = [1n, null, { nested: ['value'] }];

        expect(detectStructuredFormats(value)).toEqual({
            json: value,
            sql: null,
            plan: null,
        });
    });

    it('serializes the full structured value for raw display and copying', () => {
        const value = Array.from({ length: 1000 }, (_, index) => BigInt(index));
        const text = structuredValueToText(value);

        expect(text).toContain('"0n"');
        expect(text).toContain('"999n"');
    });
});
