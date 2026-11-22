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
        it('s', () => {
            const catalog = dql!.createCatalog();
            const script = dql!.createScript(catalog);
            script.insertTextAt(0, 's');
            script.analyze();
            script.moveCursor(1);

            const completion = script.completeAtCursor(10).read();
            const candidates = Array.from({ length: completion.candidatesLength() }, (_, i) => completion.candidates(i)!.completionText()!);
            // The keywords that start with the prefix come first, select leads them
            expect(candidates[0]).toEqual('select');
            expect(candidates).toContain('set');
        });
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
        scriptA.moveCursor(text.length);
        const completion = scriptA.completeAtCursor(10);

        const completionReader = completion.read()
        expect(completionReader.candidatesLength()).toBeGreaterThan(0);
        const candidate = completionReader.candidates(0);
        expect(candidate?.catalogObjectsLength()).toEqual(1);
        expect(candidate?.completionText()).toEqual("\"attrA\"");
        const catalogObject = candidate!.catalogObjects(0)!;
        expect(catalogObject.qualifiedNameLength()).toEqual(2);
        const name0 = catalogObject.qualifiedName(0)!;
        const name1 = catalogObject.qualifiedName(1)!;
        expect(name0).toEqual("\"T\"");
        expect(name1).toEqual("\"attrA\"");
    });

});
