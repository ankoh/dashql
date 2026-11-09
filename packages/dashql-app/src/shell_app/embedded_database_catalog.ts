import * as arrow from 'apache-arrow';
import * as dashql from '@ankoh/dashql-core';

import { catalogTablesFromPgAttribute, pgAttributeQuery, type PgAttributeColumnsTable } from '../connections/catalog/catalog_query_pg_attribute.js';
import { DEFAULT_DATABASE_NAME, packCatalogTable, packRelationName, readRelationName } from '../connections/catalog/catalog_sql_generator.js';

const LAYER = dashql.buffers.catalog.CatalogLayer.CONNECTION;

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

    /// Ask the database about what a statement touched, before the prompt returns. Also after a failure: a statement of
    /// many may have run.
    async afterStatement(statement: string): Promise<void> {
        const relations = this.core.touchedRelations(statement).map(name => readRelationName(name, DEFAULT_DATABASE_NAME));
        for (const databaseName of new Set(relations.map(relation => relation.databaseName))) {
            const ofDatabase = relations.filter(relation => relation.databaseName === databaseName);
            const queryDatabaseName = databaseName === DEFAULT_DATABASE_NAME ? null : databaseName;
            const rows = await this.query(pgAttributeQuery({ queryDatabaseName, relations: ofDatabase })) as PgAttributeColumnsTable;
            const tables = catalogTablesFromPgAttribute(rows, databaseName);
            this.catalog.replaceTables(this.entryId, LAYER, { relations: ofDatabase.map(packRelationName), tables: tables.map(packCatalogTable) });
        }
    }

    destroy(): void {
        this.catalog.dropDescriptor(this.entryId);
    }
}
