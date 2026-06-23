import * as core from '../../core/index.js';

import { AgentIntent } from './agent_prompts.js';
import { NotebookState, ScriptData } from '../notebook_state.js';

/// Input handed to every context contributor.
export interface AgentContextInput {
    /// The full notebook state (catalog, scripts, …).
    notebook: NotebookState;
    /// The focused script that is the subject of the prompt (may be null if nothing focused).
    contextScriptData: ScriptData | null;
    /// The (possibly overridden) intent for this run.
    intent: AgentIntent;
}

/// A context contributor returns a context fragment, or null if it has nothing to add.
/// Contributors are composed in order; their non-null fragments are concatenated into the
/// prompt's context block. This keeps context construction pluggable — new contributors
/// (last query result, full catalog, neighbouring scripts, …) can be slotted in later
/// without touching the driver.
export type AgentContextContributor = (input: AgentContextInput) => string | null;

/// The focused script's current SQL text.
export const focusedScriptContributor: AgentContextContributor = (input) => {
    const data = input.contextScriptData;
    if (data == null) return null;
    const text = data.script.toString().trim();
    if (text.length === 0) return null;
    return `Current script:\n${text}`;
};

/// The schema (table + column names) of the tables *referenced* by the focused script.
/// Deliberately scoped to referenced tables only — not the whole catalog — so the prompt
/// stays small and on-topic. Resolves references from the focused script's analyzed buffer
/// and looks up column detail from the connection catalog.
export const referencedTablesSchemaContributor: AgentContextContributor = (input) => {
    const data = input.contextScriptData;
    if (data == null) return null;
    const analyzed = data.scriptAnalysis.buffers.analyzed;
    if (analyzed == null) return null;

    // Collect the names of resolved tables referenced by the focused script.
    const referenced = collectReferencedTableNames(analyzed.read());
    if (referenced.size === 0) return null;

    // Look up the columns for those tables from the catalog.
    const schemas = lookupTableSchemas(input.notebook.connectionCatalog, referenced);
    if (schemas.length === 0) return null;

    const lines = ['Referenced table schemas:'];
    for (const { table, columns } of schemas) {
        lines.push(`- ${table}(${columns.join(', ')})`);
    }
    return lines.join('\n');
};

/// The default v1 contributor chain.
export const DEFAULT_CONTRIBUTORS: AgentContextContributor[] = [
    focusedScriptContributor,
    referencedTablesSchemaContributor,
];

/// Build the prompt context block by running the contributor chain and joining fragments.
export function buildAgentContext(
    input: AgentContextInput,
    contributors: AgentContextContributor[] = DEFAULT_CONTRIBUTORS,
): string {
    const fragments: string[] = [];
    for (const contributor of contributors) {
        const fragment = contributor(input);
        if (fragment != null && fragment.length > 0) {
            fragments.push(fragment);
        }
    }
    return fragments.join('\n\n');
}

/// Collect the lower-cased names of the resolved tables referenced by an analyzed script.
function collectReferencedTableNames(analyzed: core.buffers.analyzer.AnalyzedScript): Set<string> {
    const names = new Set<string>();
    const tmpRef = new core.buffers.analyzer.TableReference();
    const tmpResolved = new core.buffers.analyzer.ResolvedTable();
    const tmpQualified = new core.buffers.analyzer.QualifiedTableName();
    for (let i = 0; i < analyzed.tableReferencesLength(); ++i) {
        const ref = analyzed.tableReferences(i, tmpRef)!;
        const resolved = ref.resolvedTable(tmpResolved);
        // Only include tables that actually resolved against the catalog.
        const qualified = (resolved ?? ref).tableName(tmpQualified);
        const tableName = qualified?.tableName();
        if (tableName) names.add(tableName.toLowerCase());
    }
    return names;
}

interface TableSchema {
    table: string;
    columns: string[];
}

/// Look up the columns of the named tables from a flattened catalog snapshot.
///
/// We use the flattened snapshot (`createSnapshot`/`dashql_catalog_flatten`) rather than
/// `describeEntries`: the latter leaves the WASM flatbuffer builder in a nested state that
/// corrupts the next `analyze()` call (the loop's verify step). The snapshot is the read API
/// the rest of the app uses. The snapshot is cached on the catalog and owned by it, so we
/// must NOT destroy it here.
function lookupTableSchemas(catalog: core.DashQLCatalog, wanted: Set<string>): TableSchema[] {
    const result: TableSchema[] = [];
    const reader = catalog.createSnapshot().read();
    const flat = reader.catalogReader;

    const tmpTable = new core.buffers.catalog.FlatCatalogEntry();
    const tmpColumn = new core.buffers.catalog.FlatCatalogEntry();
    const seen = new Set<string>();

    for (let t = 0; t < flat.tablesLength(); ++t) {
        const table = flat.tables(t, tmpTable)!;
        const tableName = reader.readName(table.nameId());
        if (!tableName) continue;
        const key = tableName.toLowerCase();
        if (!wanted.has(key) || seen.has(key)) continue;
        seen.add(key);

        // Columns are a contiguous range in the flattened column array.
        const columns: string[] = [];
        const begin = table.childBegin();
        const end = begin + table.childCount();
        for (let c = begin; c < end && c < flat.columnsLength(); ++c) {
            const column = flat.columns(c, tmpColumn)!;
            const columnName = reader.readName(column.nameId());
            if (columnName) columns.push(columnName);
        }
        result.push({ table: tableName, columns });
    }
    return result;
}
