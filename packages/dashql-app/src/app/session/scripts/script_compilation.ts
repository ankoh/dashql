import * as core from '@ankoh/dashql-core';

import { ConnectorType } from '../../connections/connector_info.js';
import type { LoggerLike } from '../../../platform/logger/logger.js';
import type { ResolvedVisualizeQuery } from './script_types.js';

const LOG_CTX = 'script_compilation';

/// The formatting of compiled queries in the dialect of the connector
function executionFormattingConfig(connectorType: ConnectorType): core.buffers.formatting.FormattingConfigT {
    return new core.buffers.formatting.FormattingConfigT(
        connectorType === ConnectorType.TRINO
            ? core.buffers.formatting.FormattingDialect.TRINO
            : core.buffers.formatting.FormattingDialect.HYPER,
        core.buffers.formatting.FormattingMode.INLINE,
        120,
        2,
        false,
    );
}

/// The statement that a chart of the script visualizes, the last statement. Null when the script has no statement.
/// Compilation errors, e.g. of other statements, do not matter here, the rewrite of a tag refuses unparsed scripts.
export function chartStatementId(scriptSession: core.DashQLScriptSession): number | null {
    const reader = scriptSession.compileQuery(executionFormattingConfig(ConnectorType.HYPER)).read();
    const statementId = reader.terminalStatementId();
    return statementId === 0xFFFFFFFF ? null : statementId;
}

export function compileVisualizeQuery(scriptSession: core.DashQLScriptSession, connectorType: ConnectorType,
    logger?: LoggerLike): ResolvedVisualizeQuery | null {
    const compiled = scriptSession.compileQuery(executionFormattingConfig(connectorType));
    const reader = compiled.read();
    if (reader.errorsLength() > 0 ||
        reader.kind() !== core.buffers.execution.ScriptCompilationStatementKind.VISUALIZE) {
        return null;
    }
    const sql = reader.sql();
    const visualization = reader.visualization();
    if (!sql || !visualization) return null;
    logger?.debug('Compiled visualization for execution', { sql }, LOG_CTX);
    return resolveCompiledVisualization(sql, visualization.unpack(), reader.terminalStatementId());
}

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
