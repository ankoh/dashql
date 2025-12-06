import * as dashql from '@ankoh/dashql-core';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

export function encodeCatalogAsProto(snap: dashql.DashQLCatalogSnapshot, conn: pb.dashql.connection.ConnectionParams | null): pb.dashql.catalog.Catalog {
    const snapReader = snap.read();

    const databases: pb.dashql.catalog.CatalogDatabase[] = [];
    const schemas: pb.dashql.catalog.CatalogSchema[] = [];
    const tables: pb.dashql.catalog.CatalogTable[] = [];
    const columns: pb.dashql.catalog.CatalogTableColumn[] = [];

    const tmpEntry = new dashql.buffers.catalog.FlatCatalogEntry();
    for (let i = 0; i < snapReader.catalogReader.databasesLength(); ++i) {
        const entry = snapReader.catalogReader.databases(i, tmpEntry)!;
        const name = snapReader.readName(entry.nameId());
        databases.push(buf.create(pb.dashql.catalog.CatalogDatabaseSchema, { name }));
    }
    for (let i = 0; i < snapReader.catalogReader.schemasLength(); ++i) {
        const entry = snapReader.catalogReader.schemas(i, tmpEntry)!;
        const name = snapReader.readName(entry.nameId());
        const schema = buf.create(pb.dashql.catalog.CatalogSchemaSchema, { name });
        schemas.push(schema);
        databases[entry.flatParentIdx()].schemas.push(schema);
    }
    for (let i = 0; i < snapReader.catalogReader.tablesLength(); ++i) {
        const entry = snapReader.catalogReader.tables(i, tmpEntry)!;
        const name = snapReader.readName(entry.nameId());
        const table = buf.create(pb.dashql.catalog.CatalogTableSchema, { name });
        tables.push(table);
        schemas[entry.flatParentIdx()].tables.push(table);
    }
    for (let i = 0; i < snapReader.catalogReader.columnsLength(); ++i) {
        const entry = snapReader.catalogReader.columns(i, tmpEntry)!;
        const name = snapReader.readName(entry.nameId());
        const column = buf.create(pb.dashql.catalog.CatalogTableColumnSchema, { name });
        columns.push(column);
        tables[entry.flatParentIdx()].columns.push(column);
    }

    const out = buf.create(pb.dashql.catalog.CatalogSchema$, {
        connectionParams: conn ?? undefined,
        databases
    });
    return out;
}

