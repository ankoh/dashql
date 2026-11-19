import * as core from '../../core/index.js';

import type { ResolvedVisualizeQuery } from './script_types.js';

export function resolveCompiledVisualization(
    sql: string,
    visualization: core.buffers.execution.CompiledVisualizationT,
    statementId: number,
): ResolvedVisualizeQuery | null {
    const dashboardSpec = visualization.dashboard ?? null;
    switch (visualization.renderer) {
        case 'markdown': {
            const markdownSpec = visualization.markdownSpec;
            return markdownSpec?.document ? { renderer: 'markdown', sql, statementId, markdownSpec, dashboardSpec } : null;
        }
        case 'vegalite': {
            const raw = visualization.vegaliteSpec;
            if (!raw) return null;
            try {
                return { renderer: 'vegalite', sql, statementId, vegaLiteSpec: JSON.parse(String(raw)), dashboardSpec };
            } catch {
                return null;
            }
        }
        case 'table':
            return { renderer: 'table', sql, statementId, dashboardSpec };
        default:
            return null;
    }
}
