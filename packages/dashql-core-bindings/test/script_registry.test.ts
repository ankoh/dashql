import '@jest/globals';

import * as dashql from '../src/index.js';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'node:url';

const distPath = path.resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const wasmPath = path.resolve(distPath, './dashql.wasm');

let dql: dashql.DashQL | null = null;

beforeAll(async () => {
    dql = await dashql.DashQL.create(async (imports: WebAssembly.Imports) => {
        const buf = await fs.promises.readFile(wasmPath);
        return await WebAssembly.instantiate(buf, imports);
    });
    expect(dql).not.toBeNull();
});

describe('Script Registry Tests', () => {
    it('Single restriction', () => {
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
        expect(analyzed.columnRestrictionsLength()).toEqual(1);
        expect(analyzed.constantExpressionsLength()).toEqual(1);

        const restrictionPtr = analyzed.columnRestrictions(0)!;
        const restrictionExprPtr = analyzed.expressions(restrictionPtr.rootExpressionId())!;
        const columnRefExprPtr = analyzed.expressions(restrictionPtr.columnReferenceExpressionId())!;
        expect(restrictionExprPtr.innerType()).toEqual(dashql.buffers.algebra.ExpressionSubType.Comparison);
        expect(columnRefExprPtr.innerType()).toEqual(dashql.buffers.algebra.ExpressionSubType.ColumnRefExpression);

        const columnRef: dashql.buffers.algebra.ColumnRefExpression = columnRefExprPtr.inner(new dashql.buffers.algebra.ColumnRefExpression())!;
        const resolvedColumn = columnRef.resolvedColumn();
        expect(resolvedColumn).not.toBeNull();

        const columnInfo = registry.findColumnInfo(
            resolvedColumn!.catalogTableId(),
            resolvedColumn!.columnId(),
            resolvedColumn!.referencedCatalogVersion()
        ).unpackAndDestroy();

        console.log(JSON.stringify(columnInfo, null, 4));

        analyzedPtr.destroy();
        registry.destroy();
        catalog.destroy();
        target.destroy();
        schema.destroy();
    })
});
