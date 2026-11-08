import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});

afterEach(() => {
    dql.resetUnsafe();
});

const ChangeType = dashql.buffers.catalog.CatalogChangeType;

/// The tables of a catalog entry as `db.schema.table(a, b)`
function tablesOf(catalog: dashql.DashQLCatalog, entryId: number): string[] {
    const tables: string[] = [];
    for (const entry of catalog.describeEntriesOf(entryId).unpack().entries) {
        for (const schema of entry.schemas) {
            for (const table of schema.tables) {
                tables.push(`${schema.databaseName}.${schema.schemaName}.${table.tableName}(${table.columns.map(c => c.columnName).join(', ')})`);
            }
        }
    }
    return tables.sort();
}

/// Plan a script and collect the catalog changes of its statements
function runScript(text: string, catalog = dql.createCatalog()): dashql.buffers.catalog.CatalogChangeT[] {
    const session = dql.createScriptSession(catalog);
    session.replaceText(0n, text);
    session.analyze();
    const graph = dql.planSession({
        connections: [{ id: 'c', local: false, catalog }],
        scripts: [{ name: 'script', connection: 0, session }],
        targets: [0],
    }).unpack();
    const changes = graph.nodes.flatMap(node => node.catalogChanges);
    session.destroy();
    return dql.qualifyCatalogChanges(changes, { databaseName: 'db', schemaName: 'main' });
}

describe('Catalog changes', () => {
    it('are carried by the planned statements and qualified with the defaults', () => {
        const changes = runScript('create table t (b int, a int); create table s.u as select 1 as x; drop table v; select 1');
        expect(changes.map(c => [c.changeType, c.databaseName, c.schemaName, c.relationName, c.columns.map(column => column.columnName)])).toEqual([
            [ChangeType.CREATE_RELATION, 'db', 'main', 't', ['b', 'a']],
            [ChangeType.CREATE_RELATION, 'db', 's', 'u', ['x']],
            [ChangeType.DROP_RELATION, 'db', 'main', 'v', []],
        ]);
    });

    it('carry the column types into the descriptor entry and through SQL', () => {
        const changes = runScript('create table t (a int, b text)');
        // A later statement reads the types from the catalog
        const columnsOf = (catalog: dashql.DashQLCatalog) => runScript('create table copy as select a, b from db.main.t', catalog)[0].columns
            .map(column => [column.columnName, column.columnType]);
        const expected = [['a', 'integer'], ['b', 'text']];

        const catalog = dql.createCatalog();
        const entryId = catalog.allocateEntryId();
        catalog.applyCatalogChanges(entryId, dashql.buffers.catalog.CatalogLayer.CONNECTION, changes);
        expect(columnsOf(catalog)).toEqual(expected);

        const restored = dql.createCatalog();
        const restoredId = restored.allocateEntryId();
        restored.applyCatalogChangesSql(restoredId, dashql.buffers.catalog.CatalogLayer.CONNECTION, dql.appendCatalogChangesSql('', changes));
        expect(columnsOf(restored)).toEqual(expected);
    });

    it('patch descriptor entries and roundtrip through SQL', () => {
        const changes = runScript('create table t (a int); create table u (b int); drop table t');
        const catalog = dql.createCatalog();
        const entryId = catalog.allocateEntryId();
        catalog.applyCatalogChanges(entryId, dashql.buffers.catalog.CatalogLayer.CONNECTION, changes);
        expect(tablesOf(catalog, entryId)).toEqual(['db.main.u(b)']);

        const changesSql = dql.appendCatalogChangesSql('', changes);
        expect(changesSql).toContain('CREATE TABLE "db"."main"."u"');
        expect(changesSql).toContain('DROP TABLE "db"."main"."t"');
        const restored = dql.createCatalog();
        const restoredId = restored.allocateEntryId();
        restored.applyCatalogChangesSql(restoredId, dashql.buffers.catalog.CatalogLayer.CONNECTION, changesSql);
        expect(tablesOf(restored, restoredId)).toEqual(['db.main.u(b)']);
        expect(() => restored.applyCatalogChangesSql(restoredId, dashql.buffers.catalog.CatalogLayer.CONNECTION, 'create table (')).toThrow();
    });
});
