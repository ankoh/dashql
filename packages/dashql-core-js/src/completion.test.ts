import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    const wasmBinary = await loadCoreWasm();
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
            script.moveCursor(cursor_offset);

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
            'insert',
            'values',
            'with',
            'attach',
            'create',
            'delete',
            'drop',
            'explain'
        ]));
    });

    test('what a list shows about a catalog object', () => {
        const catalog = dql!.createCatalog();
        const schema = dql!.createScript(catalog);
        schema.insertTextAt(0, 'create function myfn(x int) returns text;');
        schema.analyze();
        catalog.loadScript(schema, 0);

        const text = 'select my';
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, text);
        script.analyze();
        script.moveCursor(text.length);
        const completion = script.completeAtCursor(10).read();
        const candidates = Array.from({ length: completion.candidatesLength() }, (_, i) => completion.candidates(i)!);
        const candidate = candidates.find(c => c.displayText() === 'myfn')!;
        expect(candidate.info()).toBeNull();
        expect(candidate.catalogObjects(0)!.info()!.detail()).toEqual('(x int) → text');
    });

    test('what a list shows about a client function', () => {
        const catalog = dql!.createCatalog();
        catalog.registerClientFunctions(JSON.stringify({
            format: 1,
            namespace: 'svc',
            functions: [{
                name: 'item_get',
                method: 'GET',
                description: 'Reads an `item`.',
                options: [{ name: 'id', type: 'string', required: true }],
                columns: [{ name: 'size', type: 'BIGINT' }],
            }],
        }));
        const text = 'call svc.';
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, text);
        script.analyze();
        script.moveCursor(text.length);
        const completion = script.completeAtCursor(10).read();
        const candidate = completion.candidates(0)!;
        expect(candidate.displayText()).toEqual('item_get');
        expect(candidate.catalogObjectsLength()).toEqual(0);
        const info = candidate.info()!;
        expect(info.detail()).toEqual('(id string)');
        expect(info.description()).toEqual('Reads an `item`.');
        expect(info.parameters(0)!.name()).toEqual('id');
        expect(info.parameters(0)!.detail()).toEqual('string · required');
        expect(info.columns(0)!.name()).toEqual('size');
        expect(info.columns(0)!.detail()).toEqual('BIGINT');
    });

    test('simple qualified column name', () => {
        const catalog = dql!.createCatalog();
        const schemaScript = dql!.createScript(catalog);
        const scriptA = dql!.createScript(catalog);

        schemaScript.insertTextAt(0, "create table tableA(\"attrA\" int)")
        schemaScript.analyze();
        catalog.loadScript(schemaScript, dashql.buffers.catalog.CatalogLayer.SESSION);

        const text = "select * from tableA \"T\" where attr";
        scriptA.insertTextAt(0, text);
        scriptA.analyze();
        const cursor = scriptA.moveCursor(text.length);
        const completion = scriptA.completeAtCursor(10);

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

});
