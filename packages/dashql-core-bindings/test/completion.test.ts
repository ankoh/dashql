import '@jest/globals';

import * as dashql from '../src/index.js';
import { ScriptTemplateType } from '../gen/dashql/buffers/snippet.js';

declare const DASHQL_PRECOMPILED: (stubs: WebAssembly.Imports) => PromiseLike<WebAssembly.WebAssemblyInstantiatedSource>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create(DASHQL_PRECOMPILED);
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});

describe('DashQL Completion', () => {
    describe('single script prefix', () => {
        const test = (text: string, cursor_offset: number, expected: string[]) => {
            const catalog = dql!.createCatalog();
            const script = dql!.createScript(catalog, 1);
            script.insertTextAt(0, text);
            script.analyze();
            script.moveCursor(cursor_offset).destroy();

            const completionBuffer = script.completeAtCursor(10);
            const completion = completionBuffer.read();

            const candidates: string[] = [];
            for (let i = 0; i < completion.candidatesLength(); ++i) {
                const candidate = completion.candidates(i)!;
                candidates.push(candidate.completionText()!);
            }
            expect(candidates).toEqual(expected);
        };

        it('s', () => test('s', 1, ['select', 'set', 'values', 'with', 'create', 'table']));
    });

    test('simple candidate template', () => {
        const catalog = dql!.createCatalog();
        const registry = dql!.createScriptRegistry();
        const schemaScript = dql!.createScript(catalog, 1);
        const scriptA = dql!.createScript(catalog, 2);
        const scriptB = dql!.createScript(catalog, 3);

        schemaScript.insertTextAt(0, "create table tableA(\"attrA\" int)")
        schemaScript.analyze();
        registry.addScript(schemaScript);
        catalog.loadScript(schemaScript, 0);

        scriptA.insertTextAt(0, "select * from tableA where \"attrA\" = 42");
        scriptA.analyze();
        registry.addScript(scriptA);

        const text = "select * from tableA where attr";
        scriptB.insertTextAt(0, text);
        scriptB.analyze();
        const cursor = scriptB.moveCursor(text.search(" attr") + 6);
        const completion = scriptB.completeAtCursor(10, registry);
        cursor.destroy();

        const completionReader = completion.read()
        expect(completionReader.candidatesLength()).toEqual(10);
        const candidate = completionReader.candidates(0);
        expect(candidate?.catalogObjectsLength()).toEqual(1);
        expect(candidate?.completionText()).toEqual("\"attrA\"");
        expect(candidate?.completionTemplatesLength()).toEqual(1);
        const template = candidate?.completionTemplates(0);
        expect(template?.templateType()).toEqual(ScriptTemplateType.COLUMN_RESTRICTION);
        expect(template?.snippetsLength()).toEqual(1);
        const snippet = template?.snippets(0);
        expect(snippet?.text()).toEqual("\"attrA\" = 42");
    });

    test('simple qualified column name', () => {
        const catalog = dql!.createCatalog();
        const registry = dql!.createScriptRegistry();
        const schemaScript = dql!.createScript(catalog, 1);
        const scriptA = dql!.createScript(catalog, 2);

        schemaScript.insertTextAt(0, "create table tableA(\"attrA\" int)")
        schemaScript.analyze();
        registry.addScript(schemaScript);
        catalog.loadScript(schemaScript, 0);

        const text = "select * from tableA \"T\" where attr";
        scriptA.insertTextAt(0, text);
        scriptA.analyze();
        const cursor = scriptA.moveCursor(text.search(" attr") + 6);
        const completion = scriptA.completeAtCursor(10, registry);
        cursor.destroy();

        const completionReader = completion.read()
        expect(completionReader.candidatesLength()).toEqual(10);
        const candidate = completionReader.candidates(0);
        expect(candidate?.catalogObjectsLength()).toEqual(1);
        expect(candidate?.completionText()).toEqual("\"attrA\"");
        expect(candidate?.catalogObjectsLength()).toEqual(1);
        const catalogObject = candidate?.catalogObjects(0)!;
        expect(catalogObject.qualifiedNameLength()).toEqual(2);
        const name0 = catalogObject.qualifiedName(0)!;
        const name1 = catalogObject.qualifiedName(1)!;
        expect(name0).toEqual("\"T\"");
        expect(name1).toEqual("\"attrA\"");
    });

    describe('candidate selection', () => {
        test('candidate location update', () => {
            const catalog = dql!.createCatalog();
            const registry = dql!.createScriptRegistry();
            const schemaScript = dql!.createScript(catalog, 1);
            const script = dql!.createScript(catalog, 2);

            schemaScript.insertTextAt(0, "create table tableA(\"attrA\" int)")
            schemaScript.analyze();
            registry.addScript(schemaScript);
            catalog.loadScript(schemaScript, 0);

            const textA = "select * from tableA a where att";
            script.insertTextAt(0, textA);
            script.analyze();
            const cursorA = script.moveCursor(textA.search(" att") + 4);
            const completionA = script.completeAtCursor(10, registry);
            cursorA.destroy();

            const completionAReader = completionA.read()
            expect(completionAReader.candidatesLength()).toEqual(10);
            expect(completionAReader.strategy()).toEqual(dashql.buffers.completion.CompletionStrategy.COLUMN_REF);
            const candidate = completionAReader.candidates(0);
            expect(candidate?.catalogObjectsLength()).toEqual(1);
            expect(candidate?.completionText()).toEqual("\"attrA\"");
            expect(candidate?.targetLocation()?.unpack()).toEqual({ offset: 29, length: 3 });
            expect(candidate?.candidateTags()! & dashql.buffers.completion.CandidateTag.KEYWORD_DEFAULT).toEqual(0);
            expect(candidate?.candidateTags()! & dashql.buffers.completion.CandidateTag.KEYWORD_POPULAR).toEqual(0);
            expect(candidate?.candidateTags()! & dashql.buffers.completion.CandidateTag.KEYWORD_VERY_POPULAR).toEqual(0);

            const textB = "select * from tableA a where \"attrA\"";
            script.replaceText(textB);
            script.analyze();
            const cursorB = script.moveCursor(textB.search("A\"") + 2);
            const completionB = script.selectCompletionCandidateAtCursor(completionA, 0);
            cursorB.destroy();
            const completionBReader = completionB.read();
            expect(completionBReader.candidatesLength()).toEqual(1);
        });
    });
});
