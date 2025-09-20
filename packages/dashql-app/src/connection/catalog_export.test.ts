import '@jest/globals';

import * as dashql from '@ankoh/dashql-core';

import { encodeCatalogAsProto } from './catalog_export.js';

declare const DASHQL_PRECOMPILED: (stubs: WebAssembly.Imports) => PromiseLike<WebAssembly.WebAssemblyInstantiatedSource>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create(DASHQL_PRECOMPILED);
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});

describe('Catalog Export', () => {
    it('can export example catalog', async () => {
        const catalog = dql!.createCatalog();
        catalog.addDescriptorPool(1, 10);
        catalog.addSchemaDescriptorT(
            1,
            new dashql.buffers.catalog.SchemaDescriptorT('db1', 'schema1', [
                new dashql.buffers.catalog.SchemaTableT(0, 'table1', [
                    new dashql.buffers.catalog.SchemaTableColumnT('column1'),
                    new dashql.buffers.catalog.SchemaTableColumnT('column2'),
                    new dashql.buffers.catalog.SchemaTableColumnT('column3'),
                ]),
                new dashql.buffers.catalog.SchemaTableT(0, 'table2', [
                    new dashql.buffers.catalog.SchemaTableColumnT('column1'),
                    new dashql.buffers.catalog.SchemaTableColumnT('column2'),
                    new dashql.buffers.catalog.SchemaTableColumnT('column3'),
                ]),
            ])
        );
        catalog.addSchemaDescriptorT(
            1,
            new dashql.buffers.catalog.SchemaDescriptorT('db1', 'schema2', [
                new dashql.buffers.catalog.SchemaTableT(0, 'table1', [
                    new dashql.buffers.catalog.SchemaTableColumnT('column1'),
                    new dashql.buffers.catalog.SchemaTableColumnT('column2'),
                    new dashql.buffers.catalog.SchemaTableColumnT('column3'),
                ]),
            ]),
        );

        const snap = catalog.createSnapshot();
        const proto = encodeCatalogAsProto(snap);

        expect(proto.databases.length).toEqual(1);
        expect(proto.databases[0].schemas.length).toEqual(2);
        expect(proto.databases[0].schemas[0].tables.length).toEqual(2);
        expect(proto.databases[0].schemas[0].tables[0].columns.length).toEqual(3);
        expect(proto.databases[0].schemas[0].tables[1].columns.length).toEqual(3);
        expect(proto.databases[0].schemas[1].tables.length).toEqual(1);
        expect(proto.databases[0].schemas[1].tables[0].columns.length).toEqual(3);
    });
});

