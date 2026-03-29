import * as dashql from '../core/index.js';

import { encodeCatalogAsProto } from './catalog_export.js';

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

describe('Catalog Export', () => {
    it('can export example catalog', async () => {
        const catalog = dql!.createCatalog();
        const catalogEntryId = catalog.addDescriptorPool(10);
        catalog.addSchemaDescriptorT(
            catalogEntryId,
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
            catalogEntryId,
            new dashql.buffers.catalog.SchemaDescriptorT('db1', 'schema2', [
                new dashql.buffers.catalog.SchemaTableT(0, 'table1', [
                    new dashql.buffers.catalog.SchemaTableColumnT('column1'),
                    new dashql.buffers.catalog.SchemaTableColumnT('column2'),
                    new dashql.buffers.catalog.SchemaTableColumnT('column3'),
                ]),
            ]),
        );

        const snap = catalog.createSnapshot();
        const proto = encodeCatalogAsProto(snap, null);

        expect(proto.databases.length).toEqual(1);
        expect(proto.databases[0].schemas.length).toEqual(2);
        expect(proto.databases[0].schemas[0].tables.length).toEqual(2);
        expect(proto.databases[0].schemas[0].tables[0].columns.length).toEqual(3);
        expect(proto.databases[0].schemas[0].tables[1].columns.length).toEqual(3);
        expect(proto.databases[0].schemas[1].tables.length).toEqual(1);
        expect(proto.databases[0].schemas[1].tables[0].columns.length).toEqual(3);
    });
});

