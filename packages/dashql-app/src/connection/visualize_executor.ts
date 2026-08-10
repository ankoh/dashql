import type { TopLevelSpec } from 'vega-lite';

import * as buffers from '../core/buffers.js';
import { resolveSymbolSpan } from '../core/tokens.js';
import { ResolvedVisualizeQuery } from '../scripts/script_types.js';
import { parseUmapSpec } from '../view/visualization/umap/umap_spec.js';
import { DashQLScriptBuffers } from '../view/editor/dashql_processor.js';
import { type LoggerLike } from '../platform/logger/logger.js';

const LOG_CTX = 'visualize_executor';

/// Resolves the executable SQL and the Vega-Lite spec for the first VISUALIZE
/// statement in `scriptBuffers`. Returns null if the script does not contain a
/// VIS_VISUALISE statement, or if the source could not be resolved.
///
/// `scriptText` is the source of the script that owns `scriptBuffers`.
export function resolveVisualizeQuery(
    scriptBuffers: DashQLScriptBuffers,
    scriptText: string,
    logger?: LoggerLike,
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
        case buffers.analyzer.VisSourceKind.INLINE_SELECT: {
            const nodeId = spec.sourceInlineSelectAstNodeId();
            const parsed = parsedPtr.read();
            const tokens = parsed.tokens();
            const node = parsed.nodes(nodeId);
            const span = node?.symbolSpan() ?? null;
            if (tokens && span) {
                const ts = resolveSymbolSpan(tokens, span);
                sql = scriptText.substr(ts.offset, ts.length).trim();
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
            // Log the final Vega-Lite JSON so the generated spec can be inspected
            // (e.g. to check which field-def properties like `stack` survived transcoding).
            logger?.info('Generated Vega-Lite spec', { spec: vegaLiteSpecRaw }, LOG_CTX);
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
