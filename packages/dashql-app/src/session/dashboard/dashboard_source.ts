import type { LoggerLike } from '../../platform/logger/logger.js';
import { chartStatementId } from '../scripts/script_compilation.js';
import type { ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import { SET_SCRIPT_TEXT, type ScriptData } from '../scripts/session_scripts.js';
import { DASHBOARD_DEFAULT_HEIGHT, type DashboardPlacement } from './dashboard_layout.js';

const LOG_CTX = 'dashboard';

/// The renderers of a card
export type DashboardRenderer = 'table' | 'vegalite' | 'markdown';

/// The statement that a card shows: the visualized statement, the statement with the `@board` tag, or the last one
function cardStatementId(script: ScriptData): number | null {
    return script.annotations.visualizeQuery?.statementId
        ?? script.annotations.boardPosition?.statementId
        ?? chartStatementId(script.scriptSession);
}

/// Write a placement into the `@board` tag of the statement that the card shows.
/// A collapsed card shows one row, it keeps the height of its tag for the card it becomes with a renderer.
/// A placement is not staged, but it joins a diff that the card already stages, rejecting the diff moves the card back.
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
            withDiff: script.pendingDiff != null,
        },
    });
}

/// Give the card of a script a renderer, its `@vis` tag. Without a renderer, the tag is removed and the card collapses
/// to its script, its `@board` tag keeps the placement. The rewrite is staged as a diff to accept or reject, like in
/// the feed. Returns false if the tag could not be written.
export function setDashboardRenderer(
    script: ScriptData,
    renderer: DashboardRenderer | null,
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
    modifySessionScripts({ type: SET_SCRIPT_TEXT, value: { scriptKey: script.scriptKey, text, withDiff: true } });
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
