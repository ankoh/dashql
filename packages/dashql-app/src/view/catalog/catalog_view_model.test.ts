import '@jest/globals';

import * as dashql from '@ankoh/dashql-core';

import { CatalogViewModel } from './catalog_view_model.js';
import { RENDERING_SETTINGS } from './catalog_viewer.js';

declare const DASHQL_PRECOMPILED: (stubs: WebAssembly.Imports) => PromiseLike<WebAssembly.WebAssemblyInstantiatedSource>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create(DASHQL_PRECOMPILED);
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});

describe('CatalogViewModel', () => {
    it('2 tables', () => {
        const registry = dql!.createScriptRegistry();
        const catalog = dql!.createCatalog();
        const schemaText = `
            CREATE TABLE table1 (
                col1 integer,
                col2 integer,
                col3 integer,
                col4 integer,
                col5 integer,
                col6 integer
            );
            CREATE TABLE table2 (
                col1 integer,
                col2 integer,
                col3 integer,
                col4 integer,
                col5 integer,
                col6 integer
            );
        `;
        const schemaScript = dql!.createScript(catalog, 1);
        schemaScript.insertTextAt(0, schemaText);
        schemaScript.analyze();
        catalog.loadScript(schemaScript, 1);

        const snapshotPtr = catalog.createSnapshot();
        const snapshot = snapshotPtr.read();
        expect(snapshot.catalogReader.databasesLength()).toEqual(1);
        expect(snapshot.catalogReader.schemasLength()).toEqual(1);
        expect(snapshot.catalogReader.tablesLength()).toEqual(2);
        expect(snapshot.catalogReader.columnsLength()).toEqual(12);

        const catalogVM = new CatalogViewModel(snapshotPtr, registry, RENDERING_SETTINGS);
        catalogVM.layoutEntries();
        expect(catalogVM.totalHeight).toEqual(
            // Database
            RENDERING_SETTINGS.levels.databases.levelGap +
            RENDERING_SETTINGS.levels.databases.nodeHeight +
            // Schema
            RENDERING_SETTINGS.levels.schemas.levelGap +
            RENDERING_SETTINGS.levels.schemas.nodeHeight +
            // Table1
            RENDERING_SETTINGS.levels.tables.levelGap +
            RENDERING_SETTINGS.levels.tables.nodeHeight +
            // Table1 Columns
            RENDERING_SETTINGS.levels.columns.levelGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            RENDERING_SETTINGS.levels.columns.rowGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            RENDERING_SETTINGS.levels.columns.rowGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            // Table1 Overflow
            RENDERING_SETTINGS.levels.columns.rowGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            // Table2
            RENDERING_SETTINGS.levels.tables.rowGap +
            RENDERING_SETTINGS.levels.tables.nodeHeight +
            // Table2 Columns
            RENDERING_SETTINGS.levels.columns.levelGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            RENDERING_SETTINGS.levels.columns.rowGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            RENDERING_SETTINGS.levels.columns.rowGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            // Table2 Overflow
            RENDERING_SETTINGS.levels.columns.rowGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight
        );

        const queryText = `
            select col4 from table1;
        `;
        const queryScript = dql!.createScript(catalog, 2);
        queryScript.insertTextAt(0, queryText);
        queryScript.analyze();
        const analyzed = queryScript.getAnalyzed();
        const analyzedReader = analyzed.read();
        expect(analyzedReader.tableReferencesLength()).toEqual(1);
        expect(analyzedReader.expressionsLength()).toEqual(1);

        catalogVM.pinScriptRefs(analyzedReader);
        expect(catalogVM.totalHeight).toEqual(
            // Database
            RENDERING_SETTINGS.levels.databases.levelGap +
            RENDERING_SETTINGS.levels.databases.nodeHeight +
            // Schema
            RENDERING_SETTINGS.levels.schemas.levelGap +
            RENDERING_SETTINGS.levels.schemas.nodeHeight +
            // Table1
            RENDERING_SETTINGS.levels.tables.levelGap +
            RENDERING_SETTINGS.levels.tables.nodeHeight +
            // Table1 Columns
            RENDERING_SETTINGS.levels.columns.levelGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            RENDERING_SETTINGS.levels.columns.rowGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            RENDERING_SETTINGS.levels.columns.rowGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            // Newly pinned column col4
            RENDERING_SETTINGS.levels.columns.rowGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            // Table1 Overflow
            RENDERING_SETTINGS.levels.columns.rowGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            // Table2
            RENDERING_SETTINGS.levels.tables.rowGap +
            RENDERING_SETTINGS.levels.tables.nodeHeight +
            // Table2 Columns
            RENDERING_SETTINGS.levels.columns.levelGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            RENDERING_SETTINGS.levels.columns.rowGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            RENDERING_SETTINGS.levels.columns.rowGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight +
            // Table2 Overflow
            RENDERING_SETTINGS.levels.columns.rowGap +
            RENDERING_SETTINGS.levels.columns.nodeHeight
        );
    });
});
