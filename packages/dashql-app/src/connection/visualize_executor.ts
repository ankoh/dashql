import type { TopLevelSpec } from 'vega-lite';

import * as buffers from '../core/buffers.js';
import { resolveSymbolSpan } from '../core/tokens.js';
import { ResolvedVisualizeQuery } from '../notebook/notebook_types.js';
import { parseUmapSpec } from '../view/visualization/umap/umap_spec.js';
import { DashQLScriptBuffers } from '../view/editor/dashql_processor.js';

/// Looks up a script's text by its (folder, file) coordinates.
/// Returns null if the script does not exist in the notebook.
export type ScriptTextByPath = (folder: string, file: string) => string | null;

function quoteIdent(name: string): string {
    return '"' + name.replace(/"/g, '""') + '"';
}

/// Reads the `"<folder>/<file>"` path a VISUALIZE script reference points at.
///
/// Script references are encoded as `dashql.notebook."<folder>/<file>"`; the
/// combined "<folder>/<file>" lives in the `table_name` slot of the spec's
/// qualified name. Returns `[folder, file]` when the slot holds a well-formed
/// path, otherwise null.
function readScriptReferencePath(spec: buffers.analyzer.VisualizationSpec): [string, string] | null {
    const tmpName = new buffers.analyzer.QualifiedTableName();
    const qname = spec.sourceQualifiedName(tmpName);
    const path = qname?.tableName() ?? null;
    if (!path) return null;
    const slash = path.indexOf('/');
    if (slash > 0 && slash < path.length - 1) {
        return [path.substring(0, slash), path.substring(slash + 1)];
    }
    return null;
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
    lookupScriptText: ScriptTextByPath,
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
            const ref = readScriptReferencePath(spec);
            if (ref) {
                sql = lookupScriptText(ref[0], ref[1]);
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
