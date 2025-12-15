import * as dashql from '@ankoh/dashql-core';
import * as pb from '@ankoh/dashql-protobuf';

export function decodeCatalogFromProto(catalog: pb.dashql.catalog.Catalog): dashql.buffers.catalog.SchemaDescriptorsT {
    if (!catalog) {
        return new dashql.buffers.catalog.SchemaDescriptorsT();
    }
    let tableCount: number = 0;
    const schemas: dashql.buffers.catalog.SchemaDescriptorT[] = [];

    for (const dbReader of catalog.databases) {
        for (const schemaReader of dbReader.schemas) {
            const tables: dashql.buffers.catalog.SchemaTableT[] = [];
            for (const tableReader of schemaReader.tables) {
                const columns: dashql.buffers.catalog.SchemaTableColumnT[] = [];
                let ordinalPos = 0;
                for (const columnReader of tableReader.columns) {
                    const column = new dashql.buffers.catalog.SchemaTableColumnT(columnReader.name, ordinalPos++);
                    columns.push(column);
                }
                const tableId = tableCount++;
                const table = new dashql.buffers.catalog.SchemaTableT(tableId, tableReader.name, columns);
                tables.push(table);
            }
            const schema = new dashql.buffers.catalog.SchemaDescriptorT(dbReader.name, schemaReader.name, tables);
            schemas.push(schema);
        }
    }
    return new dashql.buffers.catalog.SchemaDescriptorsT(schemas);
}
