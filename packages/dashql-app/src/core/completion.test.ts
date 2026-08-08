import * as dashql from './index.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    const wasmBinary = await DASHQL_PRECOMPILED;
    dql = await dashql.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});

describe('DashQL Completion', () => {
    describe('single script prefix', () => {
        const test = (text: string, cursor_offset: number, expected: string[]) => {
            const catalog = dql!.createCatalog();
            const script = dql!.createScript(catalog);
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

        it('s', () => test('s', 1, [
            'select',
            'set',
            'values',
            'visualise',
            'visualize',
            'with',
            'create',
            'explain',
            'table'
        ]));
    });

    test('simple candidate template', () => {
        const catalog = dql!.createCatalog();
        const registry = dql!.createScriptRegistry();
        const schemaScript = dql!.createScript(catalog);
        const scriptA = dql!.createScript(catalog);
        const scriptB = dql!.createScript(catalog);

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
        const cursor = scriptB.moveCursor(text.length);
        const completion = scriptB.completeAtCursor(10, registry);
        cursor.destroy();

        const completionReader = completion.read()
        expect(completionReader.candidatesLength()).toEqual(10);
        const candidate = completionReader.candidates(0);
        expect(candidate?.catalogObjectsLength()).toEqual(1);
        expect(candidate?.completionText()).toEqual("\"attrA\"");
        const candidateObject = candidate?.catalogObjects(0);
        expect(candidateObject?.scriptTemplatesLength()).toEqual(1);
        const template = candidateObject?.scriptTemplates(0);
        expect(template?.templateType()).toEqual(dashql.buffers.snippet.ScriptTemplateType.COLUMN_RESTRICTION);
        expect(template?.snippetsLength()).toEqual(1);
        const snippet = template?.snippets(0);
        expect(snippet?.text()).toEqual("\"attrA\" = 42");
    });

    test('simple qualified column name', () => {
        const catalog = dql!.createCatalog();
        const registry = dql!.createScriptRegistry();
        const schemaScript = dql!.createScript(catalog);
        const scriptA = dql!.createScript(catalog);

        schemaScript.insertTextAt(0, "create table tableA(\"attrA\" int)")
        schemaScript.analyze();
        registry.addScript(schemaScript);
        catalog.loadScript(schemaScript, 0);

        const text = "select * from tableA \"T\" where attr";
        scriptA.insertTextAt(0, text);
        scriptA.analyze();
        const cursor = scriptA.moveCursor(text.length);
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

    describe('script qualified name', () => {
        test('dot completion after dashql.script. in SELECT FROM', () => {
            const catalog = dql!.createCatalog();

            // Script A: produces a synthetic table via script_path
            const scriptA = dql!.createScript(catalog);
            scriptA.setScriptPath('main/01-script.sql');
            scriptA.insertTextAt(0, 'SELECT 1 as x, 2 as y');
            scriptA.analyze();
            catalog.loadScript(scriptA, 0);

            // Script B: references the synthetic script table via dot completion
            const text = 'SELECT * FROM dashql.script.';
            const scriptB = dql!.createScript(catalog);
            scriptB.insertTextAt(0, text);
            scriptB.analyze();
            const cursor = scriptB.moveCursor(text.length);
            const completion = scriptB.completeAtCursor(10);
            cursor.destroy();

            const reader = completion.read();
            const candidates: string[] = [];
            for (let i = 0; i < reader.candidatesLength(); ++i) {
                candidates.push(reader.candidates(i)!.completionText()!);
            }
            // The script path is not a valid bare identifier, so it is quoted for insertion.
            expect(candidates).toContain('"main/01-script.sql"');
        });

        test('dot completion after dashql.script. in VISUALIZE', () => {
            const catalog = dql!.createCatalog();

            const scriptA = dql!.createScript(catalog);
            scriptA.setScriptPath('main/01-script.sql');
            scriptA.insertTextAt(0, 'SELECT 1 as x, 2 as y');
            scriptA.analyze();
            catalog.loadScript(scriptA, 0);

            const text = 'VISUALIZE dashql.script.';
            const scriptB = dql!.createScript(catalog);
            scriptB.insertTextAt(0, text);
            scriptB.analyze();
            const cursor = scriptB.moveCursor(text.length);
            const completion = scriptB.completeAtCursor(10);
            cursor.destroy();

            const reader = completion.read();
            const candidates: string[] = [];
            for (let i = 0; i < reader.candidatesLength(); ++i) {
                candidates.push(reader.candidates(i)!.completionText()!);
            }
            // The script path is not a valid bare identifier, so it is quoted for insertion.
            expect(candidates).toContain('"main/01-script.sql"');
        });

        test('rename updates completion candidates', () => {
            const catalog = dql!.createCatalog();

            // First registration with old path
            const scriptA = dql!.createScript(catalog);
            scriptA.setScriptPath('main/01-old.sql');
            scriptA.insertTextAt(0, 'SELECT 1 as x');
            scriptA.analyze();
            catalog.loadScript(scriptA, 0);

            // Rename: re-set path and re-analyze
            scriptA.setScriptPath('main/02-renamed.sql');
            scriptA.analyze();
            catalog.loadScript(scriptA, 0);

            // Dot-complete should show new name, not old
            const text = 'SELECT * FROM dashql.script.';
            const scriptB = dql!.createScript(catalog);
            scriptB.insertTextAt(0, text);
            scriptB.analyze();
            const cursor = scriptB.moveCursor(text.length);
            const completion = scriptB.completeAtCursor(10);
            cursor.destroy();

            const reader = completion.read();
            const candidates: string[] = [];
            for (let i = 0; i < reader.candidatesLength(); ++i) {
                candidates.push(reader.candidates(i)!.completionText()!);
            }
            // The script path is not a valid bare identifier, so it is quoted for insertion.
            expect(candidates).toContain('"main/02-renamed.sql"');
            expect(candidates).not.toContain('"main/01-old.sql"');
        });

        test('execution output schema updates qualified column completion', () => {
            const catalog = dql!.createCatalog();
            const source = dql!.createScript(catalog);
            source.setScriptPath('main/source');
            source.insertTextAt(0, 'SELECT * FROM remote_table');
            source.analyze();
            catalog.loadScript(source, 0);

            expect(source.setOutputSchema(['customer_id', 'customer_name'])).toBe(true);
            expect(source.setOutputSchema(['customer_id', 'customer_name'])).toBe(false);
            source.analyze();
            catalog.loadScript(source, 0);

            const text = 'SELECT * FROM dashql.script."main/source" AS s WHERE s.customer_';
            const consumer = dql!.createScript(catalog);
            consumer.insertTextAt(0, text);
            consumer.analyze();
            consumer.moveCursor(text.length).destroy();
            const completion = consumer.completeAtCursor(10).read();
            const candidates: string[] = [];
            for (let i = 0; i < completion.candidatesLength(); ++i) {
                candidates.push(completion.candidates(i)!.completionText()!);
            }
            expect(candidates).toContain('customer_id');
            expect(candidates).toContain('customer_name');
        });
    });

    describe('candidate selection', () => {
        test('candidate location update', () => {
            const catalog = dql!.createCatalog();
            const registry = dql!.createScriptRegistry();
            const schemaScript = dql!.createScript(catalog);
            const script = dql!.createScript(catalog);

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
            expect(candidate?.candidateTags()! & dashql.buffers.completion.CandidateTag.KEYWORD_D).toEqual(0);
            expect(candidate?.candidateTags()! & dashql.buffers.completion.CandidateTag.KEYWORD_C).toEqual(0);
            expect(candidate?.candidateTags()! & dashql.buffers.completion.CandidateTag.KEYWORD_B).toEqual(0);

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
