import * as dashql from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DashQLCompletionStatus } from '../editor/dashql_processor.js';
import { QUALIFIED_TABLE_COLUMN_ID, QUALIFIED_TABLE_ID } from './catalog_object_id.js';
import { deriveFocusFromCompletionCandidates, deriveFocusFromEditorUpdate, FOCUSED_COMPLETION, FOCUSED_EXPRESSION_ID, FOCUSED_TABLE_REF_ID, FocusType } from './focus.js';
import type { ScriptData } from './session_scripts.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql.resetUnsafe();
});

/// The script data of a script completed at its end against a catalog with one table, selecting the candidate with the
/// display text, or a candidate index
function completedScript(text: string, candidate: string | number, catalogObjectId = 0): ScriptData {
    const catalog = dql.createCatalog();
    const schema = dql.createScript(catalog);
    schema.insertTextAt(0, 'create table orders(order_id int, amount int)');
    schema.analyze();
    catalog.loadScript(schema, 0);

    const script = dql.createScript(catalog);
    script.insertTextAt(0, text);
    script.analyze();
    script.moveCursor(text.length);
    const buffer = script.completeAtCursor(10);
    const completion = buffer.read();
    const candidateId = typeof candidate === 'number'
        ? candidate
        : Array.from({ length: completion.candidatesLength() }, (_, i) => completion.candidates(i)!.displayText()).indexOf(candidate);
    expect(candidateId).toBeGreaterThanOrEqual(0);
    return {
        completion: {
            status: DashQLCompletionStatus.AVAILABLE,
            passiveHint: false,
            buffer,
            candidateId,
            candidatePatch: [],
            catalogObjectId,
            catalogObjectPatch: [],
            catalogObjectCursorOffset: null,
        },
    } as unknown as ScriptData;
}

describe('deriveFocusFromCompletionCandidates', () => {
    it('focuses the column of a column candidate', () => {
        const script = completedScript('select * from orders where order', 'order_id');
        const focus = deriveFocusFromCompletionCandidates(1, script)!;
        expect(focus.focusTarget).toEqual({
            type: FOCUSED_COMPLETION,
            value: { completion: script.completion!.buffer, completionCandidateIndex: script.completion!.candidateId },
        });
        expect(focus.catalogObject?.type).toEqual(QUALIFIED_TABLE_COLUMN_ID);
        expect(focus.catalogObject?.focus).toEqual(FocusType.COMPLETION_CANDIDATE);
    });

    it('focuses the table of a table candidate', () => {
        const focus = deriveFocusFromCompletionCandidates(1, completedScript('select * from ord', 'orders'))!;
        expect(focus.catalogObject?.type).toEqual(QUALIFIED_TABLE_ID);
    });

    it('focuses the candidate without a catalog object past its objects', () => {
        const focus = deriveFocusFromCompletionCandidates(1, completedScript('select * from ord', 'orders', 99))!;
        expect(focus.focusTarget.type).toEqual(FOCUSED_COMPLETION);
        expect(focus.catalogObject).toBeNull();
    });

    it('derives no focus without a completion or past the candidates', () => {
        expect(deriveFocusFromCompletionCandidates(1, { completion: null } as unknown as ScriptData)).toBeNull();
        expect(deriveFocusFromCompletionCandidates(1, completedScript('select * from ord', 99))).toBeNull();
    });
});

describe('deriveFocusFromEditorUpdate', () => {
    const Kind = dashql.buffers.editor.EditorCursorSemanticKind;
    const SCRIPT_KEY = 3;
    const id = (referenceId: number) => dashql.ExternalObjectID.create(SCRIPT_KEY, referenceId);
    const update = (context: object) => ({ primaryCursorContext: context }) as unknown as dashql.buffers.editor.EditorUpdateT;
    const context = (kind: number, resolved: boolean) => ({
        kind,
        resolved,
        referenceId: 1,
        catalogDatabaseId: 10,
        catalogSchemaId: 11,
        catalogTableId: 12,
        catalogColumnId: 13,
        referencedCatalogVersion: 7,
        relatedTableReferenceIds: [0, 1],
        relatedColumnReferenceIds: [1, 2],
    });

    it('derives no focus without a cursor context', () => {
        expect(deriveFocusFromEditorUpdate(SCRIPT_KEY, null)).toBeNull();
        expect(deriveFocusFromEditorUpdate(SCRIPT_KEY, update(null as never))).toBeNull();
        expect(deriveFocusFromEditorUpdate(SCRIPT_KEY, update(context(Kind.NONE, true)))).toBeNull();
    });

    it('focuses the table under the cursor and the references of the table', () => {
        const focus = deriveFocusFromEditorUpdate(SCRIPT_KEY, update(context(Kind.TABLE_REFERENCE, true)))!;
        expect(focus.focusTarget).toEqual({ type: FOCUSED_TABLE_REF_ID, value: { tableReference: id(1) } });
        expect(focus.catalogObject).toEqual({
            type: QUALIFIED_TABLE_ID,
            value: { database: 10, schema: 11, table: 12, referencedCatalogVersion: 7 },
            focus: FocusType.TABLE_REF,
        });
        expect([...focus.scriptTableRefs]).toEqual([
            [id(0), FocusType.TABLE_REF_OF_TARGET_TABLE],
            [id(1), FocusType.TABLE_REF_UNDER_CURSOR],
        ]);
        expect([...focus.scriptColumnRefs]).toEqual([
            [id(1), FocusType.COLUMN_REF_OF_TARGET_TABLE],
            [id(2), FocusType.COLUMN_REF_OF_TARGET_TABLE],
        ]);
    });

    it('focuses the column under the cursor and the references of the column', () => {
        const focus = deriveFocusFromEditorUpdate(SCRIPT_KEY, update(context(Kind.COLUMN_REFERENCE, true)))!;
        expect(focus.focusTarget).toEqual({ type: FOCUSED_EXPRESSION_ID, value: { expression: id(1) } });
        expect(focus.catalogObject).toEqual({
            type: QUALIFIED_TABLE_COLUMN_ID,
            value: { database: 10, schema: 11, table: 12, column: 13, referencedCatalogVersion: 7 },
            focus: FocusType.COLUMN_REF,
        });
        expect([...focus.scriptTableRefs]).toEqual([
            [id(0), FocusType.TABLE_REF_OF_TARGET_COLUMN],
            [id(1), FocusType.TABLE_REF_OF_TARGET_COLUMN],
        ]);
        expect([...focus.scriptColumnRefs]).toEqual([
            [id(1), FocusType.COLUMN_REF_UNDER_CURSOR],
            [id(2), FocusType.COLUMN_REF_OF_TARGET_COLUMN],
        ]);
    });

    it('focuses no catalog object of an unresolved reference', () => {
        const focus = deriveFocusFromEditorUpdate(SCRIPT_KEY, update(context(Kind.COLUMN_REFERENCE, false)))!;
        expect(focus.catalogObject).toBeNull();
        expect(focus.scriptColumnRefs.size).toBe(2);
    });
});
