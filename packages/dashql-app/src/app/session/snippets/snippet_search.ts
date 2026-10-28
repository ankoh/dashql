import * as arrow from 'apache-arrow';

import type { EmbeddedComputeDatabase, EmbeddedTableImportConnection } from '../../../platform/database/embedded_database.js';
import { quoteLiteral } from '../../../platform/hyperdb/hyperdb_incremental_extract.js';
import { ConnectorType } from '../../connections/connector_info.js';
import type { SnippetRegistry } from './snippet_registry.js';

/// The table of the snippets in the snippet database, one row per snippet and connector
export const SNIPPET_SEARCH_TABLE = 'snippets';

/// The rows of the snippet table
function snippetRows(registry: SnippetRegistry): arrow.Table {
    const rows = registry.snippets.flatMap(snippet => snippet.connectors.map(connector => ({
        id: snippet.id,
        category: snippet.category,
        connector: ConnectorType[connector],
        path: snippet.paths.get(connector)!,
        description: snippet.description,
        body: snippet.bodies.get(connector)!,
    })));
    return arrow.tableFromArrays({
        id: rows.map(row => row.id),
        category: rows.map(row => row.category),
        connector: rows.map(row => row.connector),
        path: rows.map(row => row.path),
        description: rows.map(row => row.description),
        body: rows.map(row => row.body),
    });
}

/// The ILIKE pattern of the snippets that contain a text, the wildcards in the text match only themselves
export function snippetSearchPattern(text: string): string {
    return `%${text.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}

/// The full-text search over the snippets in the snippet database of the embedded Hyper.
/// The search runs its statements one after the other on one connection, the database serves one statement at a
/// time per connection.
export class SnippetSearch {
    /// The registry in the snippet table, null before the first search
    private loaded: SnippetRegistry | null = null;
    /// The last statement sequence, the next one starts after it
    private operation: Promise<unknown> = Promise.resolve();

    constructor(private readonly connection: EmbeddedTableImportConnection) {}

    /// Connect to the snippet database of a database instance
    static async connect(database: EmbeddedComputeDatabase): Promise<SnippetSearch> {
        return new SnippetSearch(await database.connect({ defaultDatabase: '__dashql_snippets' }));
    }

    /// The ids of the snippets of a registry that run on a connector and contain a text in their id, description or
    /// text, ignoring case. The snippet table is filled with the registry first, if it holds another one.
    search(registry: SnippetRegistry, connector: ConnectorType, text: string): Promise<Set<string>> {
        return this.enqueue(async () => {
            if (this.loaded !== registry) {
                this.loaded = null;
                await this.connection.execute(`DROP TABLE IF EXISTS ${SNIPPET_SEARCH_TABLE}`);
                await this.connection.insertArrowTable(snippetRows(registry), { name: SNIPPET_SEARCH_TABLE, create: true });
                this.loaded = registry;
            }
            const pattern = quoteLiteral(snippetSearchPattern(text));
            const matches = (column: string) => `${column} ILIKE ${pattern} ESCAPE '\\'`;
            const result = await this.connection.query(`
                SELECT id FROM ${SNIPPET_SEARCH_TABLE}
                WHERE connector = ${quoteLiteral(ConnectorType[connector])}
                    AND (${matches('id')} OR ${matches('description')} OR ${matches('body')})
            `);
            const ids = new Set<string>();
            for (const id of result.getChild('id') ?? []) ids.add(String(id));
            return ids;
        });
    }

    /// Close the connection after the running search
    close(): Promise<void> {
        return this.enqueue(() => this.connection.close());
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.operation.then(operation, operation);
        this.operation = next.catch(() => {});
        return next;
    }
}

/// The snippet searches by database instance, one connection per instance
const SEARCHES = new WeakMap<EmbeddedComputeDatabase, Promise<SnippetSearch>>();

/// The snippet search of a database instance, connected once
export function getSnippetSearch(database: EmbeddedComputeDatabase): Promise<SnippetSearch> {
    let search = SEARCHES.get(database);
    if (search == null) {
        search = SnippetSearch.connect(database);
        search.catch(() => SEARCHES.delete(database));
        SEARCHES.set(database, search);
    }
    return search;
}
