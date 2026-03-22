import * as dashql from './index.js';

declare const DASHQL_PRECOMPILED: (stubs: WebAssembly.Imports) => PromiseLike<WebAssembly.WebAssemblyInstantiatedSource>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create(DASHQL_PRECOMPILED);
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});


describe('DashQL Analyzer', () => {
    it(`external ref`, () => {
        const catalog = dql!.createCatalog();
        const extScript = dql!.createScript(catalog);
        extScript.insertTextAt(0, 'create table foo(a int);');
        extScript.analyze();

        const extScannedPtr = extScript.getScanned();
        const extParsedPtr = extScript.getParsed();
        const extAnalyzedPtr = extScript.getAnalyzed();
        expect(extScannedPtr.read().tokens()?.tokenTypesArray()?.length).toBeGreaterThan(0);
        expect(extParsedPtr.read().nodesLength()).toBeGreaterThan(0);
        expect(extAnalyzedPtr.read().tablesLength()).toEqual(1);

        catalog.loadScript(extScript, 0);
        expect(catalog.containsEntryId(1)).toBeTruthy();

        const mainScript = dql!.createScript(catalog);
        mainScript.insertTextAt(0, 'select * from foo');
        mainScript.analyze();

        const mainScannedPtr = mainScript.getScanned();
        const mainParsedPtr = mainScript.getParsed();
        const mainAnalyzedPtr = mainScript.getAnalyzed();
        const mainAnalyzed = mainAnalyzedPtr.read();
        expect(mainScannedPtr.read().tokens()?.tokenTypesArray()?.length).toBeGreaterThan(0);
        expect(mainParsedPtr.read().nodesLength()).toBeGreaterThan(0);
        expect(mainAnalyzed.tableReferencesLength()).toEqual(1);

        const tableRef = mainAnalyzed.tableReferences(0)!;
        expect(tableRef.resolvedTable()).not.toBeNull();
        const resolved = tableRef.resolvedTable(new dashql.buffers.analyzer.ResolvedTable())!;
        expect(resolved.tableName()!.tableName()!).toEqual('foo');
    });
});
