import type { TopLevelSpec } from 'vega-lite';

import * as buffers from '../core/buffers.js';
import { resolveSymbolSpan } from '../core/tokens.js';
import { ResolvedVisualizeQuery } from '../notebook/notebook_types.js';
import { parseUmapSpec } from '../view/visualization/umap/umap_spec.js';
import { DashQLScriptBuffers } from '../view/editor/dashql_processor.js';

/// Looks up a script's text by its notebook scriptKey (its catalog entry id).
/// Returns null if no such script exists in the notebook.
export type ScriptTextByKey = (scriptKey: number) => string | null;

function quoteIdent(name: string): string {
    return '"' + name.replace(/"/g, '""') + '"';
}

/// The producing script's scriptKey for a VISUALIZE script reference.
///
/// A script reference resolves through the catalog to the producing script's synthetic output table.
/// The resolved table id is packed as `(catalog_entry_id << 32) | table_index`, and the catalog
/// entry id equals the producing script's notebook scriptKey. Returns null when the reference did
/// not resolve (packed id 0 — entry ids start at 1, so a valid id is always >= 2^32).
function readScriptReferenceKey(spec: buffers.analyzer.VisualizationSpec): number | null {
    const packed = spec.sourceResolvedTableId();
    if (packed === 0n) return null;
    return Number(packed >> 32n);
}

/// Resolves the executable SQL and the Vega-Lite spec for the first VISUALIZE
/// statement in `scriptBuffers`. Returns null if the script does not contain a
/// VIS_VISUALISE statement, or if the source could not be resolved.
///
/// `scriptText` is the source of the script that owns `scriptBuffers` (used for
/// the inline-select case). `lookupScriptText` is consulted only for
/// ScriptReference sources.
export function resolveVisualizeQuery(
    scriptBuffers: DashQLScriptBuffers,
    scriptText: string,
    lookupScriptText: ScriptTextByKey,
): ResolvedVisualizeQuery | null {
    const analyzedPtr = scriptBuffers.analyzed;
    const parsedPtr = scriptBuffers.parsed;
    if (!analyzedPtr || !parsedPtr) return null;

    const analyzed = analyzedPtr.read();
    if (analyzed.visualizationSpecsLength() === 0) return null;

    const tmpSpec = new buffers.analyzer.VisualizationSpec();
    const spec = analyzed.visualizationSpecs(0, tmpSpec);
    if (!spec) return null;

    const renderer = spec.renderer();

    let sql: string | null = null;
    switch (spec.sourceKind()) {
        case buffers.analyzer.VisSourceKind.SCRIPT_REFERENCE: {
            const producerKey = readScriptReferenceKey(spec);
            if (producerKey != null) {
                sql = lookupScriptText(producerKey);
            }
            break;
        }
        case buffers.analyzer.VisSourceKind.TABLE_REFERENCE: {
            const tmpName = new buffers.analyzer.QualifiedTableName();
            const qname = spec.sourceQualifiedName(tmpName);
            if (qname) {
                const parts: string[] = [];
                const db = qname.databaseName();
                const schema = qname.schemaName();
                const tbl = qname.tableName();
                if (db) parts.push(quoteIdent(db));
                if (schema) parts.push(quoteIdent(schema));
                if (tbl) parts.push(quoteIdent(tbl));
                if (parts.length > 0) {
                    sql = `SELECT * FROM ${parts.join('.')}`;
                }
            }
            break;
        }
        case buffers.analyzer.VisSourceKind.INLINE_SELECT: {
            const nodeId = spec.sourceInlineSelectAstNodeId();
            const parsed = parsedPtr.read();
            const tokens = parsed.tokens();
            const node = parsed.nodes(nodeId);
            const span = node?.symbolSpan() ?? null;
            if (tokens && span) {
                const ts = resolveSymbolSpan(tokens, span);
                // Strip the wrapping parentheses inserted by the grammar (`LRB sql_select_stmt RRB`)
                const inner = scriptText.substr(ts.offset + 1, Math.max(ts.length - 2, 0));
                sql = inner.trim();
            }
            break;
        }
        default:
            break;
    }

    if (!sql) return null;

    // Branch on the renderer named after `USING`. Each renderer stores its own
    // spec string on the analyzed VisualizationSpec.
    switch (renderer) {
        case 'umap': {
            const raw = spec.umapSpec();
            if (!raw) return null;
            const umapSpec = parseUmapSpec(raw);
            if (!umapSpec) return null;
            return { renderer: 'umap', sql, umapSpec };
        }
        case 'vegalite':
        default: {
            const vegaLiteSpecRaw = spec.vegaliteSpec();
            if (!vegaLiteSpecRaw) return null;
            let vegaLiteSpec: TopLevelSpec;
            try {
                vegaLiteSpec = JSON.parse(vegaLiteSpecRaw) as TopLevelSpec;
            } catch {
                return null;
            }
            return { renderer: 'vegalite', sql, vegaLiteSpec };
        }
    }
}
