import '@jest/globals';

import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { decodeCatalogFileFromProto } from './catalog_import.js';

describe('Catalog Import', () => {
    it('can import example file catalog', async () => {
        const catalogPb = buf.create(pb.dashql.catalog.CatalogSchema$, {
            connectionParams: buf.create(pb.dashql.connection.ConnectionParamsSchema, {
                connection: {
                    case: "demo",
                    value: {}
                }
            }),
            databases: [
                buf.create(pb.dashql.catalog.CatalogDatabaseSchema, {
                    name: "db1",
                    schemas: [
                        buf.create(pb.dashql.catalog.CatalogSchemaSchema, {
                            name: "schema1",
                            tables: [
                                buf.create(pb.dashql.catalog.CatalogTableSchema, {
                                    name: "table1",
                                    columns: [
                                        buf.create(pb.dashql.catalog.CatalogTableColumnSchema, { name: "column1" }),
                                        buf.create(pb.dashql.catalog.CatalogTableColumnSchema, { name: "column2" }),
                                        buf.create(pb.dashql.catalog.CatalogTableColumnSchema, { name: "column3" }),
                                    ]
                                }),
                                buf.create(pb.dashql.catalog.CatalogTableSchema, {
                                    name: "table2",
                                    columns: [
                                        buf.create(pb.dashql.catalog.CatalogTableColumnSchema, { name: "column1" }),
                                        buf.create(pb.dashql.catalog.CatalogTableColumnSchema, { name: "column2" }),
                                        buf.create(pb.dashql.catalog.CatalogTableColumnSchema, { name: "column3" }),
                                    ]
                                })
                            ]
                        }),
                        buf.create(pb.dashql.catalog.CatalogSchemaSchema, {
                            name: "schema2",
                            tables: [
                                buf.create(pb.dashql.catalog.CatalogTableSchema, {
                                    name: "table1",
                                    columns: [
                                        buf.create(pb.dashql.catalog.CatalogTableColumnSchema, { name: "column1" }),
                                        buf.create(pb.dashql.catalog.CatalogTableColumnSchema, { name: "column2" }),
                                        buf.create(pb.dashql.catalog.CatalogTableColumnSchema, { name: "column3" }),
                                    ]
                                })
                            ]
                        })
                    ]
                })
            ]
        });

        const schemaDescriptors = decodeCatalogFileFromProto(catalogPb);
        expect(schemaDescriptors.schemas.length).toEqual(2);
        expect(schemaDescriptors.schemas[0].tables.length).toEqual(2);
        expect(schemaDescriptors.schemas[0].tables[0].columns.length).toEqual(3);
        expect(schemaDescriptors.schemas[0].tables[1].columns.length).toEqual(3);
        expect(schemaDescriptors.schemas[1].tables.length).toEqual(1);
        expect(schemaDescriptors.schemas[1].tables[0].columns.length).toEqual(3);
    });
});

