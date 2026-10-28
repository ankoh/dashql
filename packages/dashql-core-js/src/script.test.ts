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

describe('DashQL scripts', () => {
    it('can be created', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        expect(script).not.toBeUndefined();
        script.destroy();
        catalog.destroy();
    });

    it('are initially empty', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        expect(script).not.toBeUndefined();
        expect(script.toString()).toEqual('');
        script.destroy();
        catalog.destroy();
    });

    it('should throw for accesses after deletion', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.destroy();
        catalog.destroy();
        expect(() => script.toString()).toThrow(dashql.NULL_POINTER_EXCEPTION);
        expect(() => script.insertTextAt(0, 'foo')).toThrow(dashql.NULL_POINTER_EXCEPTION);
        expect(() => script.eraseTextRange(0, 1)).toThrow(dashql.NULL_POINTER_EXCEPTION);
    });

    it('can be deleted repeatedly', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        expect(script).not.toBeUndefined();
        expect(script.toString()).toEqual('');
        script.destroy();
        script.destroy();
        script.destroy();
        catalog.destroy();
    });

    describe('text modifications', () => {
        it('inserting a single character', () => {
            const catalog = dql!.createCatalog();
            const script = dql!.createScript(catalog);
            script.insertTextAt(0, 'a');
            expect(script.toString()).toEqual('a');
            script.destroy();
            catalog.destroy();
        });
    });

    it('returns statement text without its separator or surrounding trivia', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `  SELECT ';' AS value ; -- trailing comment\n`);

        expect(script.getStatementText()).toBe(`SELECT ';' AS value`);

        script.destroy();
        catalog.destroy();
    });

    it('visualizes the terminal query with a Vega-Lite spec', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, '/* @vis table */ select 1 as a');

        expect(script.rewriteVegaLite('{"mark": "bar"}')).toEqual({ offset: 8, length: 27 });
        expect(script.toString()).toBe('/* @vis vegalite\n   {"mark": "bar"} */ select 1 as a');
        expect(() => script.rewriteVegaLite('[]')).toThrow('the Vega-Lite spec is no JSON object');

        // The analyzer warns about fields that are no output columns
        script.rewriteVegaLite('{"mark": "bar", "encoding": {"x": {"field": "b"}}}');
        script.analyze();
        const analyzed = script.getAnalyzed();
        const error = analyzed.read().errors(0);
        expect(error?.errorType()).toBe(dashql.buffers.analyzer.AnalyzerErrorType.INVALID_VIS_TAG);
        expect(error?.message()).toBe('unknown field "b", the statement has the columns a');
        analyzed.destroy();

        script.destroy();
        catalog.destroy();
    });

    it('analyzes insert write targets through wasm', () => {
        const catalog = dql!.createCatalog();
        const schema = dql!.createScript(catalog);
        schema.insertTextAt(0, 'create table target(id int, label text);');
        schema.analyze();
        catalog.loadScript(schema, dashql.buffers.catalog.CatalogLayer.SESSION);

        const script = dql!.createScript(catalog);
        script.insertTextAt(0, "insert into target(id, label) values (1, 'one') returning id");
        script.analyze();
        const analyzedBuffer = script.getAnalyzed();
        const analyzed = analyzedBuffer.read();

        expect(analyzed.insertStatementsLength()).toBe(1);
        expect(analyzed.insertStatements(0)!.targetColumnsLength()).toBe(2);
        expect(analyzed.tableReferencesLength()).toBe(1);
        expect(analyzed.tableReferences(0)!.role()).toBe(dashql.buffers.analyzer.TableReferenceRole.WRITE);

        analyzedBuffer.destroy();
        script.destroy();
        schema.destroy();
        catalog.destroy();
    });

    it('remains editable after analysis', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.replaceText('select 1');
        script.analyze();
        script.getAnalyzed().destroy();
        script.replaceText('select 2');
        script.analyze();
        expect(script.toString()).toBe('select 2');
        script.getAnalyzed().destroy();
        script.destroy();
        catalog.destroy();
    });
});
