import * as core from '../../../core/index.js';

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';

import { DashQLScannerDecorationUpdateEffect, DashQLStandaloneScannerDecorationPlugin } from '../scripts/editor/dashql_decorations_standalone.js';
import { releaseAppliedPreviewSnapshot, releasePreviewSnapshot, type PreviewSnapshot } from './script_preview.js';
import { buildUnformattedPreview } from './script_preview_lifecycle.js';
import { xcodeLight } from '../scripts/editor/themes/xcode.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL | null = null;
beforeAll(async () => {
    dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => dql!.resetUnsafe());

const JSON_TABLE_SCRIPT = `/*
  We want to support the following json_table in BDT:
JSON_TABLE(
    payload__c,
    '$' COLUMNS (
        NESTED PATH '$.orders[*]' COLUMNS (
            order_id TEXT PATH '$.order_id',
            NESTED PATH '$.items[*]' COLUMNS (
                item_id TEXT PATH '$.item_id',
                price NUMBER PATH '$.price'
            ))))
  This can be evaluated entirely without jsonpath as:
*/
WITH source(payload__c) AS (
  VALUES
    ( '{"tag": "test-order-1",
        "orders": [
          { "order_id": "ORD-1001", "items": [
              {"item_id": "ITEM-101", "price": 19.99},
              {"item_id": "ITEM-102", "price": 7.50}
            ] },
          { "order_id": "ORD-1002", "items": [ {"item_id": "ITEM-201", "price": 125.00} ] } ]}'
    ),
    ( '{"tag": "test-order-2",
        "orders": [
          { "order_id": "ORD-2001",
            "items": [ {"item_id": "ITEM-301", "price": 42.25} ] } ]}'
    ))
SELECT
    payload_json ->> 'tag' AS tag,
    order_json   ->> 'order_id' AS order_id,
    item_json    ->> 'item_id' AS item_id,
    (item_json   ->> 'price')::numeric AS price
FROM source AS s
CROSS JOIN ( SELECT s.payload__c::json AS payload_json ) AS parsed
CROSS JOIN json_array_elements(payload_json -> 'orders') AS orders(order_json)
CROSS JOIN json_array_elements(order_json -> 'items') AS items(item_json);`;

describe('releasePreviewSnapshot', () => {
    it('detaches CodeMirror extensions before releasing WASM buffers', () => {
        const calls: string[] = [];
        const dispatch = vi.fn((_transaction: unknown) => calls.push('dispatch'));
        const view = {
            dispatch,
        };
        const diffBuffer = {
            destroy: vi.fn(() => calls.push('diff')),
        };

        releasePreviewSnapshot({
            scriptText: 'select 1;',
            editorUpdate: null,
            diff: { priorText: 'select 0;', diffBuffer },
        } as unknown as PreviewSnapshot, view);

        expect(calls).toEqual(['dispatch', 'diff']);
        expect(dispatch).toHaveBeenCalledOnce();
        expect((dispatch.mock.calls[0]![0] as { effects: unknown[] }).effects).toHaveLength(3);
    });

    it('does not detach a newer snapshot when an unapplied snapshot is released', () => {
        const dispatch = vi.fn();
        const oldSnapshot = {
            scriptText: 'select 1;',
            editorUpdate: null,
            diff: null,
        } as unknown as PreviewSnapshot;
        const appliedSnapshot = {
            scriptText: 'select 2;',
            editorUpdate: null,
            diff: null,
        } as unknown as PreviewSnapshot;
        const applied = { view: { dispatch }, snapshot: appliedSnapshot } as Parameters<typeof releaseAppliedPreviewSnapshot>[1];

        expect(releaseAppliedPreviewSnapshot(oldSnapshot, applied)).toBe(applied);
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('unformatted script preview', () => {
    it('analyzes restored scripts without an editor projection', () => {
        const catalog = dql!.createCatalog();
        const scriptSession = dql!.createScriptSession(catalog);
        scriptSession.replaceText(0n, JSON_TABLE_SCRIPT);
        const logger = { warn: vi.fn() };
        const formattingConfig = new core.buffers.formatting.FormattingConfigT(
            core.buffers.formatting.FormattingDialect.HYPER,
            core.buffers.formatting.FormattingMode.COMPACT,
            80,
            2,
            false,
        );

        expect(scriptSession.isFullyFormattable(formattingConfig, true)).toBe(false);

        const snapshot = buildUnformattedPreview(dql!, {
            scriptKey: scriptSession.getCatalogEntryId(),
            scriptSession,
            editorUpdate: null,
        } as any, logger as any);

        expect(snapshot.scriptText).toBe(JSON_TABLE_SCRIPT);
        expect(snapshot.editorUpdate?.syntaxSpans.length).toBeGreaterThan(0);
        expect(snapshot.editorUpdate?.syntaxSpans.some(span =>
            span.tokenType === core.buffers.parser.ScannerTokenType.COMMENT,
        )).toBe(true);

        const view = new EditorView({
            state: EditorState.create({
                doc: snapshot.scriptText,
                extensions: [xcodeLight, DashQLStandaloneScannerDecorationPlugin],
            }),
            parent: document.body,
        });
        view.dispatch({ effects: DashQLScannerDecorationUpdateEffect.of(snapshot.editorUpdate) });
        const spans = Array.from(view.dom.querySelectorAll('span'));
        const functionNode = spans.find(node => node.textContent === 'json_array_elements');
        const commentNode = spans.find(node => node.textContent?.startsWith('/*'));
        expect(functionNode?.className).not.toBe('');
        expect(commentNode?.classList.contains('dashql-comment')).toBe(true);
        view.destroy();
        scriptSession.destroy();
        catalog.destroy();
    });
});
