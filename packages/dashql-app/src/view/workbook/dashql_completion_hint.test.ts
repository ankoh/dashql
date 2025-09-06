import '@jest/globals';

import * as dashql from '@ankoh/dashql-core';
import { Text } from '@codemirror/state';

import { computeCompletionHints, HINT_INSERT_TEXT, HINT_PRIORITY_CANDIDATE, HINT_PRIORITY_CANDIDATE_QUALIFICATION, HintTextAnchor } from './dashql_completion_hint.js';

declare const DASHQL_PRECOMPILED: (stubs: WebAssembly.Imports) => PromiseLike<WebAssembly.WebAssemblyInstantiatedSource>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    expect(DASHQL_PRECOMPILED).toBeDefined();
    dql = await dashql.DashQL.create(DASHQL_PRECOMPILED);
    expect(dql).not.toBeNull();
});

describe('Completion Hint', () => {
    it('candidate hint quoting', async () => {
        const catalog = dql!.createCatalog();
        const registry = dql!.createScriptRegistry();
        const schemaScriptPtr = dql!.createScript(catalog, 1);
        const scriptPtr = dql!.createScript(catalog, 2);

        schemaScriptPtr.insertTextAt(0, "create table tableA(\"attrA\" int)")
        schemaScriptPtr.analyze();
        registry.addScript(schemaScriptPtr);
        catalog.loadScript(schemaScriptPtr, 0);

        const text = "select * from tableA where attr";
        scriptPtr.insertTextAt(0, text);
        scriptPtr.analyze();
        const cursorPtr = scriptPtr.moveCursor(text.search(" attr") + 6);
        const completionPtr = scriptPtr.completeAtCursor(10, registry);

        const completionReader = completionPtr.read()
        expect(completionReader.candidatesLength()).toEqual(10);
        const candidate = completionReader.candidates(0);
        expect(candidate?.completionText()).toEqual("\"attrA\"");

        // Compute completion hints
        const textBuffer = Text.of([text]);
        const hints = computeCompletionHints(completionPtr, 0, textBuffer);
        expect(hints).not.toBeNull();

        // Check candidate hint
        expect(hints!.candidate.length).toEqual(2);
        expect(hints!.candidate[0]).toEqual({
            type: HINT_INSERT_TEXT,
            value: {
                at: text.length - "attr".length,
                text: "\"",
                textAnchor: HintTextAnchor.Right,
                renderingPriority: HINT_PRIORITY_CANDIDATE
            }
        });
        expect(hints!.candidate[1]).toEqual({
            type: HINT_INSERT_TEXT,
            value: {
                at: text.length,
                text: "A\"",
                textAnchor: HintTextAnchor.Left,
                renderingPriority: HINT_PRIORITY_CANDIDATE
            }
        });

        completionPtr.destroy();
        cursorPtr.destroy();
        scriptPtr.destroy();
        schemaScriptPtr.destroy();
        registry.destroy();
        catalog.destroy();
    });

    it('candidate qualification', async () => {
        const catalog = dql!.createCatalog();
        const registry = dql!.createScriptRegistry();
        const schemaScriptPtr = dql!.createScript(catalog, 1);
        const scriptPtr = dql!.createScript(catalog, 2);

        schemaScriptPtr.insertTextAt(0, "create table db0.schema0.\"tableA\"(\"attrA\" int)")
        schemaScriptPtr.analyze();
        registry.addScript(schemaScriptPtr);
        catalog.loadScript(schemaScriptPtr, 0);

        const text = "select * from tab";
        scriptPtr.insertTextAt(0, text);
        scriptPtr.analyze();
        const cursorPtr = scriptPtr.moveCursor(text.search(" tab") + 4);
        const completionPtr = scriptPtr.completeAtCursor(10, registry);

        const completionReader = completionPtr.read()
        expect(completionReader.candidatesLength()).toEqual(10);
        const candidate = completionReader.candidates(0);
        expect(candidate?.completionText()).toEqual("\"tableA\"");

        // Compute completion hints
        const textBuffer = Text.of([text]);
        const hints = computeCompletionHints(completionPtr, 0, textBuffer);
        expect(hints).not.toBeNull();

        // Check candidate hint
        expect(hints!.candidate.length).toEqual(2);
        expect(hints!.candidate[0]).toEqual({
            type: HINT_INSERT_TEXT,
            value: {
                at: text.length - "tab".length,
                text: "\"",
                textAnchor: HintTextAnchor.Right,
                renderingPriority: HINT_PRIORITY_CANDIDATE
            }
        });
        expect(hints!.candidate[1]).toEqual({
            type: HINT_INSERT_TEXT,
            value: {
                at: text.length,
                text: "leA\"",
                textAnchor: HintTextAnchor.Left,
                renderingPriority: HINT_PRIORITY_CANDIDATE
            }
        });

        // Check qualification hint
        expect(hints!.candidateQualification.length).toEqual(1);
        expect(hints!.candidateQualification[0]).toEqual({
            type: HINT_INSERT_TEXT,
            value: {
                at: text.length - "tab".length,
                text: "db0.schema0.",
                textAnchor: HintTextAnchor.Right,
                renderingPriority: HINT_PRIORITY_CANDIDATE_QUALIFICATION
            }
        });

        completionPtr.destroy();
        cursorPtr.destroy();
        scriptPtr.destroy();
        schemaScriptPtr.destroy();
        registry.destroy();
        catalog.destroy();
    });
});

