import '@jest/globals';

import * as dashql from '@ankoh/dashql-core';
import { Text } from '@codemirror/state';

import { computeCompletionHints } from './dashql_completion_hint.js';

declare const DASHQL_PRECOMPILED: (stubs: WebAssembly.Imports) => PromiseLike<WebAssembly.WebAssemblyInstantiatedSource>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
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

        const textBuffer = Text.of([text]);
        const hints = computeCompletionHints(completionPtr, 0, textBuffer);
        expect(hints).not.toBeNull();
        expect(hints!.candidate.hintPrefix).not.toBeNull();
        expect(hints!.candidate.hintPrefix!.text).toEqual("\"");
        expect(hints!.candidate.hintPrefix!.at).toEqual(text.length - "attr".length);
        expect(hints!.candidate.hintSuffix).not.toBeNull();
        expect(hints!.candidate.hintSuffix!.text).toEqual("A\"");
        expect(hints!.candidate.hintSuffix!.at).toEqual(text.length);

        cursorPtr.destroy();
        completionPtr.destroy();
        scriptPtr.destroy();
        schemaScriptPtr.destroy();
    });
});

