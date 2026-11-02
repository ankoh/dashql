import * as dashql from '@ankoh/dashql-core';
import { Text } from '@codemirror/state';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildDiffDecorations } from './dashql_diff_decorations.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql.resetUnsafe();
});

/// The decorated texts and the delete gutter lines of the diff from the source to the target text
function decorate(source: string, target: string) {
    const catalog = dql.createCatalog();
    const session = dql.createScriptSession(catalog);
    session.replaceText(session.getTextVersion(), source);
    session.analyze();
    const targetScript = dql.createScript(dql.createCatalog());
    targetScript.insertTextAt(0, target);
    targetScript.parse();
    const doc = Text.of(target.split('\n'));
    const state = buildDiffDecorations({ priorText: source, diffBuffer: session.computeDiff(targetScript) }, doc);

    const decorations: [string, string][] = [];
    state.decorations.between(0, doc.length, (from, to, decoration) => {
        decorations.push([decoration.spec.class, doc.sliceString(from, to)]);
    });
    return { decorations, deleteLines: [...state.deleteLines] };
}

describe('buildDiffDecorations', () => {
    it('decorates nothing without a pending diff', () => {
        const state = buildDiffDecorations(null, Text.of(['select 1']));
        expect(state.decorations.size).toEqual(0);
        expect(state.deleteLines.size).toEqual(0);
    });

    it('marks inserted statements', () => {
        expect(decorate('', 'select a from t;\nselect b from u;').decorations).toEqual([
            ['cm-dashql-diff-insert', 'select a from t'],
            ['cm-dashql-diff-insert', 'select b from u'],
        ]);
    });

    it('marks updated statements and their changes', () => {
        expect(decorate('select a from t where x = 1;', 'select a from t where x = 2;').decorations).toEqual([
            ['cm-dashql-diff-update', 'select a from t where x = 2'],
            ['cm-dashql-diff-change', '2'],
        ]);
    });

    it('marks moved statements', () => {
        expect(decorate('select 1;\nselect 1;', 'select 1;\nselect 1;').decorations).toEqual([
            ['cm-dashql-diff-move', 'select 1'],
            ['cm-dashql-diff-move', 'select 1'],
        ]);
    });

    it('anchors deleted statements behind the last kept statement', () => {
        const { decorations, deleteLines } = decorate('select a from t;\nselect b from u;', 'select a from t;');
        expect(decorations).toEqual([]);
        expect(deleteLines).toEqual([0]);
    });
});
