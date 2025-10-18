import '@jest/globals';

import * as dashql from '@ankoh/dashql-core';
import { Text } from '@codemirror/state';

import { deriveCompletionHints } from './dashql_completion_hint.js';
import { DashQLCompletionState, DashQLCompletionStatus } from './dashql_processor.js';
import { PATCH_INSERT_TEXT, CompletionPatchTarget, TextAnchor, computePatches } from './dashql_completion_patches.js';

declare const DASHQL_PRECOMPILED: (stubs: WebAssembly.Imports) => PromiseLike<WebAssembly.WebAssemblyInstantiatedSource>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    expect(DASHQL_PRECOMPILED).toBeDefined();
    dql = await dashql.DashQL.create(DASHQL_PRECOMPILED);
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
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
        const cursor = scriptPtr.moveCursor(text.search(" attr") + 6);
        const completionPtr = scriptPtr.completeAtCursor(10, registry);

        const completionReader = completionPtr.read()
        expect(completionReader.candidatesLength()).toEqual(10);
        const candidate = completionReader.candidates(0);
        expect(candidate?.completionText()).toEqual("\"attrA\"");

        // Compute completion hints
        const textBuffer = Text.of([text]);
        let completionState: DashQLCompletionState = {
            status: DashQLCompletionStatus.AVAILABLE,
            buffer: completionPtr,
            candidateId: 0,
            candidatePatch: [],
            catalogObjectId: 0,
            catalogObjectPatch: [],
            templateId: 0,
            templatePatch: [],
        };
        completionState = computePatches(completionState, textBuffer, cursor.read().textOffset());
        const hints = deriveCompletionHints(completionState);

        // Check candidate hint
        expect(hints!.candidateHints.length).toEqual(2);
        expect(hints!.candidateHints[0]).toEqual({
            controls: false,
            target: CompletionPatchTarget.Candidate,
            type: PATCH_INSERT_TEXT,
            value: {
                at: text.length - "attr".length,
                text: "\"",
                textAnchor: TextAnchor.Right,
            }
        });
        expect(hints!.candidateHints[1]).toEqual({
            controls: true,
            target: CompletionPatchTarget.Candidate,
            type: PATCH_INSERT_TEXT,
            value: {
                at: text.length,
                text: "A\"",
                textAnchor: TextAnchor.Right,
            }
        });
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
        const cursor = scriptPtr.moveCursor(text.search(" tab") + 4);
        const completionPtr = scriptPtr.completeAtCursor(10, registry);

        const completionReader = completionPtr.read()
        expect(completionReader.candidatesLength()).toEqual(10);
        const candidate = completionReader.candidates(0);
        expect(candidate?.completionText()).toEqual("\"tableA\"");

        // Compute completion hints
        const textBuffer = Text.of([text]);
        let completionState: DashQLCompletionState = {
            status: DashQLCompletionStatus.AVAILABLE,
            buffer: completionPtr,
            candidateId: 0,
            candidatePatch: [],
            catalogObjectId: 0,
            catalogObjectPatch: [],
            templateId: 0,
            templatePatch: [],
        };
        completionState = computePatches(completionState, textBuffer, cursor.read().textOffset());
        const hints = deriveCompletionHints(completionState);

        // Check candidate hint
        expect(hints!.candidateHints.length).toEqual(2);
        expect(hints!.candidateHints[0]).toEqual({
            controls: false,
            target: CompletionPatchTarget.Candidate,
            type: PATCH_INSERT_TEXT,
            value: {
                at: text.length - "tab".length,
                text: "\"",
                textAnchor: TextAnchor.Right,
            }
        });
        expect(hints!.candidateHints[1]).toEqual({
            controls: true,
            target: CompletionPatchTarget.Candidate,
            type: PATCH_INSERT_TEXT,
            value: {
                at: text.length,
                text: "leA\"",
                textAnchor: TextAnchor.Left,
            }
        });

        // Check qualification hint
        expect(hints!.catalogObjectHints.length).toEqual(1);
        expect(hints!.catalogObjectHints[0]).toEqual({
            controls: true,
            target: CompletionPatchTarget.CatalogObject,
            type: PATCH_INSERT_TEXT,
            value: {
                at: text.length - "tab".length,
                text: "db0.schema0.",
                textAnchor: TextAnchor.Right,
            }
        });
    });


    it.skip('use candidate as is', async () => {
        const catalog = dql!.createCatalog();
        const registry = dql!.createScriptRegistry();
        const schemaScriptPtr = dql!.createScript(catalog, 1);
        const scriptPtr = dql!.createScript(catalog, 2);

        schemaScriptPtr.insertTextAt(0, "create table db0.schema0.\"tableA\"(\"attrA\" int)")
        schemaScriptPtr.analyze();
        registry.addScript(schemaScriptPtr);
        catalog.loadScript(schemaScriptPtr, 0);

        const text = "select * from \"tableA\"";
        scriptPtr.insertTextAt(0, text);
        scriptPtr.analyze();
        const cursor = scriptPtr.moveCursor(text.search("\"tableA\"") + 4);
        const completionPtr = scriptPtr.completeAtCursor(10, registry);

        const completionReader = completionPtr.read()
        expect(completionReader.candidatesLength()).toEqual(10);
        const candidate = completionReader.candidates(0);
        expect(candidate?.completionText()).toEqual("\"tableA\"");

        // Compute completion hints
        const textBuffer = Text.of([text]);
        let completionState: DashQLCompletionState = {
            status: DashQLCompletionStatus.AVAILABLE,
            buffer: completionPtr,
            candidateId: 0,
            candidatePatch: [],
            catalogObjectId: 0,
            catalogObjectPatch: [],
            templateId: 0,
            templatePatch: [],
        };
        completionState = computePatches(completionState, textBuffer, cursor.read().textOffset());
        const hints = deriveCompletionHints(completionState);

        // Check candidate hint.
        // This time, the candidate can be used as is
        expect(hints!.candidateHints.length).toEqual(0);

        // Check qualification hint
        expect(hints!.catalogObjectHints.length).toEqual(1);
        expect(hints!.catalogObjectHints[0]).toEqual({
            controls: true,
            target: CompletionPatchTarget.CatalogObject,
            type: PATCH_INSERT_TEXT,
            value: {
                at: text.length - "tab".length,
                text: "db0.schema0.",
                textAnchor: TextAnchor.Right,
            }
        });
    });
});

