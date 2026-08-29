import * as dashql from '../../../core/index.js';

import { beforeAll, describe, expect, it } from 'vitest';

import { createScriptFormatConfig, projectFormattedText } from './script_format_preview.js';
import { measureScriptPreviewWidth, measureScriptPreviewWidthOr } from './script_preview_width.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

describe('script format preview', () => {
    it('uses the feed preview configuration for compact formatting', () => {
        const config = createScriptFormatConfig(
            dashql.buffers.formatting.FormattingMode.COMPACT,
            100,
        );

        expect(config.maxWidth).toBe(100);
        expect(config.indentationWidth).toBe(2);
    });

    it('measures compact width from the editor viewport', () => {
        const width = measureScriptPreviewWidth({
            defaultCharacterWidth: 10,
            scrollDOM: { clientWidth: 1000 },
        });

        expect(width).toBe(100);
    });

    it('falls back before the editor viewport is measurable', () => {
        expect(measureScriptPreviewWidthOr({ defaultCharacterWidth: 0 }, 80)).toBe(80);
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
                100,
            ));
            pretty = session.format(createScriptFormatConfig(
                dashql.buffers.formatting.FormattingMode.PRETTY,
                null,
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

    it('projects syntax highlighting against pretty-formatted text', () => {
        const catalog = dql.createCatalog();
        const session = dql.createScriptSession(catalog);
        let formatted: dashql.DashQLScript | null = null;
        try {
            session.replaceText(0n, 'select count(*) from items where value > 1');
            formatted = session.format(new dashql.buffers.formatting.FormattingConfigT(
                dashql.buffers.formatting.FormattingDialect.HYPER,
                dashql.buffers.formatting.FormattingMode.PRETTY,
                80,
                4,
            ));
            const text = formatted.toString();
            const update = projectFormattedText(dql, text);
            const highlightedKeywords = update.syntaxSpans
                .filter(span => span.tokenType === dashql.buffers.parser.ScannerTokenType.KEYWORD)
                .map(span => text.slice(Number(span.textSpan!.offset), Number(span.textSpan!.offset + span.textSpan!.length)).toLowerCase());

            expect(highlightedKeywords).toEqual(expect.arrayContaining(['select', 'from', 'where']));
            expect(update.syntaxSpans.every(span =>
                span.textSpan != null && Number(span.textSpan.offset + span.textSpan.length) <= text.length
            )).toBe(true);
        } finally {
            formatted?.destroy();
            session.destroy();
            catalog.destroy();
        }
    });
});
