import * as dashql from '@ankoh/dashql-core';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { acceptPendingDiff, DashQLDiffHintPlugin, rejectPendingDiff } from './dashql_diff_hint.js';
import { DashQLProcessorPlugin, DashQLUpdateEffect, type DashQLProcessorUpdateOut } from './dashql_processor.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql.resetUnsafe();
});

const PRIOR_TEXT = 'select a from t where x = 1;';
const NEW_TEXT = 'select a from t where x = 2;';

/// An editor that holds the new text of a rewrite, with the diff from the prior text pending
function createDiffEditor(pending: boolean) {
    const catalog = dql.createCatalog();
    const scriptSession = dql.createScriptSession(catalog);
    scriptSession.replaceText(scriptSession.getTextVersion(), PRIOR_TEXT);
    scriptSession.analyze();
    const target = dql.createScript(dql.createCatalog());
    target.insertTextAt(0, NEW_TEXT);
    target.parse();
    const diffBuffer = scriptSession.computeDiff(target);
    scriptSession.replaceText(scriptSession.getTextVersion(), NEW_TEXT);
    const editorUpdate = scriptSession.analyze();

    const updates: DashQLProcessorUpdateOut[] = [];
    const view = new EditorView({
        state: EditorState.create({
            doc: NEW_TEXT,
            selection: EditorSelection.cursor(0),
            extensions: [DashQLProcessorPlugin, DashQLDiffHintPlugin],
        }),
        parent: document.body,
    });
    view.dispatch({
        effects: DashQLUpdateEffect.of({
            scriptKey: scriptSession.getCatalogEntryId(),
            scriptSession,
            editorUpdate,
            scriptBuffers: null,
            scriptCompletion: null,
            scriptPendingDiff: pending ? { priorText: PRIOR_TEXT, diffBuffer } : null,
            derivedFocus: null,
            onUpdate: update => updates.push(update),
        }),
    });
    return { view, scriptSession, updates };
}

function pressKey(view: EditorView, key: string): boolean {
    return runScopeHandlers(view, new KeyboardEvent('keydown', { key }), 'editor');
}

describe('the pending diff of a rewrite', () => {
    it('is accepted with the new text', () => {
        const { view, updates } = createDiffEditor(true);
        expect(view.state.field(DashQLProcessorPlugin).scriptPendingDiff).not.toBeNull();
        expect(acceptPendingDiff(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(NEW_TEXT);
        expect(view.state.field(DashQLProcessorPlugin).scriptPendingDiff).toBeNull();
        expect(updates[updates.length - 1]?.scriptPendingDiff).toBeNull();
        view.destroy();
    });

    it('is rejected by restoring the prior text', () => {
        const { view, scriptSession, updates } = createDiffEditor(true);
        expect(rejectPendingDiff(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(PRIOR_TEXT);
        expect(view.state.field(DashQLProcessorPlugin).scriptPendingDiff).toBeNull();
        expect(updates[updates.length - 1]?.scriptPendingDiff).toBeNull();
        expect(scriptSession.getText()).toBe(PRIOR_TEXT);
        view.destroy();
    });

    it('lets Enter accept and Escape reject', () => {
        const accepted = createDiffEditor(true);
        expect(pressKey(accepted.view, 'Enter')).toBe(true);
        expect(accepted.view.state.doc.toString()).toBe(NEW_TEXT);
        expect(accepted.view.state.field(DashQLProcessorPlugin).scriptPendingDiff).toBeNull();
        accepted.view.destroy();

        const rejected = createDiffEditor(true);
        expect(pressKey(rejected.view, 'Escape')).toBe(true);
        expect(rejected.view.state.doc.toString()).toBe(PRIOR_TEXT);
        rejected.view.destroy();
    });

    it('lets the keys fall through without a pending diff', () => {
        const { view } = createDiffEditor(false);
        expect(acceptPendingDiff(view)).toBe(false);
        expect(rejectPendingDiff(view)).toBe(false);
        expect(pressKey(view, 'Escape')).toBe(false);
        expect(view.state.doc.toString()).toBe(NEW_TEXT);
        view.destroy();
    });
});
