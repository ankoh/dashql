import type { LoggerLike } from '../../platform/logger/logger.js';
import { chartStatementId } from '../scripts/script_compilation.js';
import type { ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import { SET_SCRIPT_TEXT, type ScriptData } from '../scripts/session_scripts.js';
import { DASHBOARD_DEFAULT_HEIGHT, type DashboardPlacement } from './dashboard_layout.js';

const LOG_CTX = 'dashboard';

/// The renderers that a collapsed card offers
export type DashboardRenderer = 'table' | 'vegalite' | 'markdown';

/// The statement that a card shows: the visualized statement, the statement with the `@board` tag, or the last one
function cardStatementId(script: ScriptData): number | null {
    return script.annotations.visualizeQuery?.statementId
        ?? script.annotations.boardPosition?.statementId
        ?? chartStatementId(script.scriptSession);
}

/// Write a placement into the `@board` tag of the statement that the card shows.
/// A collapsed card shows one row, it keeps the height of its tag for the card it becomes with a renderer.
export function persistDashboardPlacement(
    script: ScriptData,
    placement: DashboardPlacement,
    modifySessionScripts: ModifySessionScripts,
): void {
    const statementId = cardStatementId(script);
    if (statementId == null) return;
    const height = script.annotations.visualizeQuery != null
        ? placement.height
        : script.annotations.boardPosition?.height ?? DASHBOARD_DEFAULT_HEIGHT;
    modifySessionScripts({
        type: SET_SCRIPT_TEXT,
        value: {
            scriptKey: script.scriptKey,
            text: script.scriptSession.rewriteVisBoard(
                statementId,
                placement.row,
                placement.column,
                placement.width,
                height,
            ),
        },
    });
}

/// Give the card of a script a renderer, its `@vis` tag. Returns false if the tag could not be written.
export function setDashboardRenderer(
    script: ScriptData,
    renderer: DashboardRenderer,
    body: string,
    modifySessionScripts: ModifySessionScripts,
    logger?: LoggerLike,
): boolean {
    const statementId = cardStatementId(script);
    if (statementId == null) return false;
    let text: string;
    try {
        text = script.scriptSession.rewriteVisRenderer(statementId, renderer, body);
    } catch (e: unknown) {
        logger?.warn('Failed to write the renderer of a dashboard card', { renderer, error: String(e) }, LOG_CTX);
        return false;
    }
    modifySessionScripts({ type: SET_SCRIPT_TEXT, value: { scriptKey: script.scriptKey, text } });
    return true;
}

/// A starter Markdown row template: the first column as heading, the others in a line below
export function markdownTemplate(columns: readonly string[]): string | null {
    if (columns.length === 0) return null;
    const [first, ...rest] = columns;
    const lines = [`### {{${first}}}`];
    if (rest.length > 0) lines.push(rest.map(column => `{{${column}}}`).join(' · '));
    return lines.join('\n');
}
