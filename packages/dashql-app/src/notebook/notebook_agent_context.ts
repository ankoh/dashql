import * as core from '../core/index.js';

import { AgentIntent } from '../agent/agent_prompts.js';
import { getExecutableQueryText, NotebookState, ScriptData } from './notebook_state.js';

/// A column of a query's output schema: its name and (best-effort) type.
export interface OutputColumn {
    /// The column name.
    name: string;
    /// The column's type rendered as a string (e.g. "Utf8", "Int32"), or null if unknown.
    type: string | null;
}

/// Resolve the output columns (result schema) a script produced on its most recent execution.
/// Returns null when the script has never run (or its result schema isn't available yet) — output
/// columns only exist after execution, they are not part of static analysis. Supplied by the caller
/// (the feed) because the execution result lives in the connection state, not the notebook state.
export type OutputColumnResolver = (scriptKey: number) => OutputColumn[] | null;

/// Input handed to every context contributor.
export interface AgentContextInput {
    /// The full notebook state (catalog, scripts, …).
    notebook: NotebookState;
    /// The focused script that is the subject of the prompt (may be null if nothing focused).
    contextScriptData: ScriptData | null;
    /// The (possibly overridden) intent for this run.
    intent: AgentIntent;
    /// Resolve a script's last-execution output columns (null if never run / unavailable).
    resolveOutputColumns?: OutputColumnResolver;
}

/// A context contributor returns a context fragment, or null if it has nothing to add.
/// Contributors are composed in order; their non-null fragments are concatenated into the
/// prompt's context block. This keeps context construction pluggable — new contributors
/// (last query result, full catalog, neighbouring scripts, …) can be slotted in later
/// without touching the driver.
///
/// Contributors are intent-aware: each returns null for the intents it doesn't serve, so the
/// SQL and visualize paths get different context from the same chain. SQL edits get the query
/// text plus the base schema of the referenced relations; visualize edits get the source query
/// text, the current chart spec, and the output schema the chart binds to.
export type AgentContextContributor = (input: AgentContextInput) => string | null;

/// SQL only: the focused script's current SQL text.
export const focusedScriptContributor: AgentContextContributor = (input) => {
    if (input.intent !== 'sql') return null;
    const data = input.contextScriptData;
    if (data == null) return null;
    const text = data.script.toString().trim();
    if (text.length === 0) return null;
    return `Current script:\n${text}`;
};

/// SQL only: the schema (table + column names) of the tables *referenced* by the focused script.
/// Deliberately scoped to referenced tables only — not the whole catalog — so the prompt
/// stays small and on-topic. Resolves references from the focused script's analyzed buffer
/// and looks up column detail from the connection catalog.
export const referencedTablesSchemaContributor: AgentContextContributor = (input) => {
    if (input.intent !== 'sql') return null;
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

/// Top-level Vega-Lite keys we strip before showing a current chart to the model: the source
/// (`data`, injected by the driver) and the schema URL (`$schema`, ignored by the transcoder).
/// Both are things the prompt explicitly forbids the model from emitting, so they must not appear
/// in the example spec we hand it.
const INTERNAL_SPEC_KEYS = ['data', '$schema'] as const;

/// Return a shallow copy of a Vega-Lite spec with the internal-only top-level keys removed.
function stripInternalSpecKeys(spec: unknown): unknown {
    if (spec == null || typeof spec !== 'object') return spec;
    const clone: Record<string, unknown> = { ...(spec as Record<string, unknown>) };
    for (const key of INTERNAL_SPEC_KEYS) {
        delete clone[key];
    }
    return clone;
}

/// Visualize only: the source query that feeds the chart, plus (when editing an existing chart)
/// the current Vega-Lite spec. A VISUALIZE statement charts the output of a source SELECT; the
/// model reasons about that data, not the DashQL `VISUALIZE (…)` wrapper — so we send the source
/// query and the chart spec rather than the focused script text verbatim.
export const visualizeSourceContributor: AgentContextContributor = (input) => {
    if (input.intent !== 'visualize') return null;
    const data = input.contextScriptData;
    if (data == null) return null;

    const parts: string[] = [];
    const vis = data.annotations.visualizeQuery;
    if (vis != null) {
        // Focused script is already a VISUALIZE: send its resolved source SELECT (re-resolved when
        // the analysis is outdated so a changed source is reflected) and the current chart spec.
        const sql = getExecutableQueryText(input.notebook, data).trim();
        if (sql.length > 0) parts.push(`Source query (feeds the chart):\n${sql}`);
        try {
            // Show only the surface the model is allowed to emit. The resolved spec also carries a
            // "$schema" and a "data" member (the transcoded source), but the prompt tells the model
            // NOT to emit either — showing them as an example contradicts that instruction and a
            // small model imitates the example. The driver re-injects the real `data` regardless
            // (see visSourceToData), so dropping them here is purely cosmetic downstream.
            // Only the Vega-Lite renderer exposes an editable spec surface to the agent.
            if (vis.renderer === 'vegalite') {
                parts.push(`Current chart (Vega-Lite spec):\n${JSON.stringify(stripInternalSpecKeys(vis.vegaLiteSpec), null, 2)}`);
            }
        } catch {
            // A non-serializable spec is simply omitted — the source query + output schema still help.
        }
    } else {
        // Focused script is a plain SQL query we're about to chart: its text is the source query.
        const sql = data.script.toString().trim();
        if (sql.length > 0) parts.push(`Source query (feeds the chart):\n${sql}`);
    }
    return parts.length > 0 ? parts.join('\n\n') : null;
};

/// Visualize only: the output schema (columns + types) of the source query, taken from its most
/// recent execution. This is the schema the chart's encodings bind to, so it's the most useful
/// signal for picking fields. Best-effort: absent when the source has never run (output columns
/// are not available from static analysis).
export const visualizeOutputSchemaContributor: AgentContextContributor = (input) => {
    if (input.intent !== 'visualize') return null;
    const data = input.contextScriptData;
    if (data == null) return null;
    const columns = input.resolveOutputColumns?.(data.scriptKey) ?? null;
    if (columns == null || columns.length === 0) return null;

    const lines = ['Output columns (result schema of the source query):'];
    for (const c of columns) {
        lines.push(c.type ? `- ${c.name} (${c.type})` : `- ${c.name}`);
    }
    return lines.join('\n');
};

/// The default contributor chain. Contributors self-select by intent, so the same chain yields
/// SQL context (script + referenced-table schemas) or visualize context (source query + current
/// chart spec + output schema) depending on the run's intent.
export const DEFAULT_CONTRIBUTORS: AgentContextContributor[] = [
    focusedScriptContributor,
    referencedTablesSchemaContributor,
    visualizeSourceContributor,
    visualizeOutputSchemaContributor,
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
