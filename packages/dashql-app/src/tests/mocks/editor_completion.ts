import type * as dashql from '@ankoh/dashql-core';
import { EditorState } from '@codemirror/state';
import { expect } from 'vitest';

import { computePatches } from '../../session/editor/dashql_completion_patches.js';
import { DashQLCompletionStatus, type DashQLProcessorUpdateIn } from '../../session/editor/dashql_processor.js';

/// The editor text of the completion of the tables `orders` of two databases
export const ORDERS_COMPLETION_TEXT = 'select * from ord';

/// The processor state of an editor of the text with the cursor at its end, analyzed against the catalog
export function editorProcessorState(dql: dashql.DashQL, text: string, catalog: dashql.DashQLCatalog = dql.createCatalog()): DashQLProcessorUpdateIn {
    const scriptSession = dql.createScriptSession(catalog);
    scriptSession.replaceText(0n, text);
    expect(scriptSession.analyze().analysisAvailable).toBe(true);
    return {
        scriptKey: 1,
        scriptSession,
        editorUpdate: scriptSession.setCursor(1n, BigInt(text.length)),
        scriptBuffers: null,
        scriptCompletion: null,
        scriptPendingDiff: null,
        derivedFocus: null,
        onUpdate: () => { },
    };
}

/// The processor state of an editor at the end of `select * from ord` whose completion selects the candidate `orders`,
/// a table of the databases db0 and db1
export function ordersCompletion(dql: dashql.DashQL): DashQLProcessorUpdateIn {
    const catalog = dql.createCatalog();
    const schemaScript = dql.createScript(catalog);
    schemaScript.insertTextAt(0, [
        'create table db0.public.orders(id int);',
        'create table db1.public.orders(id int);',
    ].join('\n'));
    schemaScript.analyze();
    catalog.loadScript(schemaScript, 0);
    return completionAtEnd(dql, ORDERS_COMPLETION_TEXT, catalog, 'orders');
}

/// The processor state of an editor at the end of a text whose completion selects a candidate.
/// The setup can publish table parameters that the session reads.
export function completionAtEnd(
    dql: dashql.DashQL,
    text: string,
    catalog: dashql.DashQLCatalog,
    candidate: string,
    setup: ((session: dashql.DashQLScriptSession) => void) | null = null,
): DashQLProcessorUpdateIn {
    const state = editorProcessorState(dql, text, catalog);
    if (setup != null) {
        setup(state.scriptSession!);
        expect(state.scriptSession!.analyze().analysisAvailable).toBe(true);
        state.editorUpdate = state.scriptSession!.setCursor(2n, BigInt(text.length));
    }
    const buffer = state.scriptSession!.completeAtCursor(10);
    const completion = buffer.read();
    const candidateId = Array.from({ length: completion.candidatesLength() }, (_, i) => completion.candidates(i)?.displayText()).indexOf(candidate);
    expect(candidateId).toBeGreaterThanOrEqual(0);

    const scriptCompletion = computePatches({
        status: DashQLCompletionStatus.AVAILABLE,
        passiveHint: false,
        buffer,
        candidateId,
        candidatePatch: [],
        catalogObjectId: 0,
        catalogObjectPatch: [],
        catalogObjectCursorOffset: null,
    }, EditorState.create({ doc: text }).doc, text.length);
    return { ...state, scriptCompletion };
}
