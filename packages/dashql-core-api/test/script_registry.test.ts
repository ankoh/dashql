import '@jest/globals';

import * as dashql from '../src/index.js';

declare const DASHQL_PRECOMPILED: (stubs: WebAssembly.Imports) => PromiseLike<WebAssembly.WebAssemblyInstantiatedSource>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create(DASHQL_PRECOMPILED);
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});

describe('Script Registry Tests', () => {
    it('Single filter', () => {
        const catalog = dql!.createCatalog();

        const schema = dql!.createScript(catalog, 1);
        schema.insertTextAt(0, 'create table foo(a int);');
        schema.analyze();
        catalog.loadScript(schema, 1);

        const registry = dql!.createScriptRegistry();

        const target = dql!.createScript(catalog, 2);
        target.insertTextAt(0, 'select * from foo where a < 3');
        target.analyze();
        registry.addScript(target);

        const analyzedPtr = target.getAnalyzed();
        const analyzed = analyzedPtr.read();
        expect(analyzed.expressionsLength()).toEqual(3); // colref, literal, comparison
        expect(analyzed.columnFiltersLength()).toEqual(1);
        expect(analyzed.constantExpressionsLength()).toEqual(1);

        const filterPtr = analyzed.columnFilters(0)!;
        const filterExprPtr = analyzed.expressions(filterPtr.rootExpressionId())!;
        const columnRefExprPtr = analyzed.expressions(filterPtr.columnReferenceExpressionId())!;
        expect(filterExprPtr.innerType()).toEqual(dashql.buffers.algebra.ExpressionSubType.Comparison);
        expect(columnRefExprPtr.innerType()).toEqual(dashql.buffers.algebra.ExpressionSubType.ColumnRefExpression);

        const columnRef: dashql.buffers.algebra.ColumnRefExpression = columnRefExprPtr.inner(new dashql.buffers.algebra.ColumnRefExpression())!;
        const resolvedColumn = columnRef.resolvedColumn();
        expect(resolvedColumn).not.toBeNull();

        const columnInfoPtr = registry.findColumnInfo(
            resolvedColumn!.catalogTableId(),
            resolvedColumn!.columnId(),
            resolvedColumn!.referencedCatalogVersion()
        );
        const columnInfo = columnInfoPtr.read();
        expect(columnInfo.filterTemplatesLength()).toEqual(1);
        const template = columnInfo.filterTemplates(0)!;
        expect(template.snippetsLength()).toEqual(1);
        const snippet = template.snippets(0)!;
        expect(snippet.text()).toEqual("a < 3");
    });
});
