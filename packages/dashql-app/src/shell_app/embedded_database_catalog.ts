import * as arrow from 'apache-arrow';
import * as dashql from '@ankoh/dashql-core';

import { catalogTablesFromPgAttribute, pgAttributeQuery, type PgAttributeColumnsTable } from '../connections/catalog/catalog_query_pg_attribute.js';
import { DEFAULT_DATABASE_NAME, packCatalogDescriptor } from '../connections/catalog/catalog_sql_generator.js';

/// The catalog of a shell on an embedded database. Its descriptor holds what the database reports.
export class EmbeddedDatabaseCatalog {
    /// The catalog entry of the descriptor
    private readonly entryId: number;

    constructor(
        private readonly core: dashql.DashQL,
        private readonly catalog: dashql.DashQLCatalog,
        private readonly query: (text: string) => Promise<arrow.Table>,
    ) {
        this.entryId = catalog.allocateEntryId();
    }

    /// Read the relations again after a successful statement that may have changed them. The database is local and only
    /// holds what the shell put into it, so the query reads all of them and a statement that doesn't parse counts.
    async afterStatement(statement: string): Promise<void> {
        const touched = this.core.touchedRelations(statement);
        if (touched.parsed && touched.relations.length === 0) return;
        const relations = await this.query(pgAttributeQuery({ userSchemasOnly: true })) as PgAttributeColumnsTable;
        const tables = catalogTablesFromPgAttribute(relations, DEFAULT_DATABASE_NAME);
        this.catalog.replaceDescriptor(this.entryId, dashql.buffers.catalog.CatalogLayer.CONNECTION, packCatalogDescriptor(tables));
    }

    destroy(): void {
        this.catalog.dropDescriptor(this.entryId);
    }
}
