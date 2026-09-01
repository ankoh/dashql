import * as dashql from '../../../core/index.js';

import { beforeAll, describe, expect, it } from 'vitest';

import { createScriptFormatConfig, formatScriptEditor, measureScriptFormatWidth } from './script_format.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

describe('script formatting', () => {
    it('uses the shared configuration for compact formatting', () => {
        const config = createScriptFormatConfig(
            dashql.buffers.formatting.FormattingMode.COMPACT,
            false,
            80,
        );

        expect(config.maxWidth).toBe(80);
        expect(config.indentationWidth).toBe(4);
    });

    it('measures the formatter width from the writable editor viewport', () => {
        expect(measureScriptFormatWidth({
            defaultCharacterWidth: 8,
            scrollDOM: { clientWidth: 600 },
        } as any)).toBe(75);
        expect(measureScriptFormatWidth({
            defaultCharacterWidth: 8,
            scrollDOM: { clientWidth: 120 },
        } as any)).toBe(24);
    });

    it('keeps compact output distinct from pretty output', () => {
        const catalog = dql.createCatalog();
        const session = dql.createScriptSession(catalog);
        let compact: dashql.DashQLScript | null = null;
        let pretty: dashql.DashQLScript | null = null;
        try {
            session.replaceText(0n, 'select count(*) from items where value > 1');
            compact = session.format(createScriptFormatConfig(
                dashql.buffers.formatting.FormattingMode.COMPACT,
            ));
            pretty = session.format(createScriptFormatConfig(
                dashql.buffers.formatting.FormattingMode.PRETTY,
            ));

            expect(compact.toString()).toBe('select count(*) from items where value > 1;');
            expect(pretty.toString()).toBe('select count(*)\nfrom items\nwhere value > 1;');
        } finally {
            compact?.destroy();
            pretty?.destroy();
            session.destroy();
            catalog.destroy();
        }
    });

    it('applies pretty formatting as an edit to the writable editor', () => {
        const catalog = dql.createCatalog();
        const session = dql.createScriptSession(catalog);
        const dispatch = vi.fn();
        const focus = vi.fn();
        try {
            session.replaceText(0n, 'select count(*) from items where value > 1');
            const text = session.getText();
            const editorView = {
                state: { doc: { length: text.length, toString: () => text } },
                defaultCharacterWidth: 8,
                scrollDOM: { clientWidth: 320 },
                dispatch,
                focus,
            } as any;

            expect(formatScriptEditor(editorView, { scriptSession: session } as any,
                dashql.buffers.formatting.FormattingMode.PRETTY)).toBe(true);
            expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
                changes: {
                    from: 0,
                    to: text.length,
                    insert: 'select count(*)\nfrom items\nwhere value > 1;',
                },
            }));
            expect(focus).toHaveBeenCalledOnce();
        } finally {
            session.destroy();
            catalog.destroy();
        }
    });

    it('passes the current editor width to the formatter', () => {
        const dispatch = vi.fn();
        const focus = vi.fn();
        const destroy = vi.fn();
        const format = vi.fn((config: dashql.buffers.formatting.FormattingConfigT) => {
            expect(config.maxWidth).toBe(75);
            return { toString: () => 'select 1;', destroy };
        });
        const editorView = {
            state: { doc: { length: 8, toString: () => 'select 1' } },
            defaultCharacterWidth: 8,
            scrollDOM: { clientWidth: 600 },
            dispatch,
            focus,
        } as any;

        expect(formatScriptEditor(editorView, { scriptSession: { format } } as any,
            dashql.buffers.formatting.FormattingMode.PRETTY)).toBe(true);
        expect(format).toHaveBeenCalledOnce();
        expect(destroy).toHaveBeenCalledOnce();
    });

});
