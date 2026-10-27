import type { ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import { SET_SCRIPT_TEXT, type ScriptData } from '../scripts/session_scripts.js';
import type { DashboardPlacement } from './dashboard_layout.js';

/// Write a placement into the `@vis card` tag of the statement that the card shows
export function persistDashboardPlacement(
    script: ScriptData,
    placement: DashboardPlacement,
    modifySessionScripts: ModifySessionScripts,
): void {
    const statementId = script.annotations.visualizeQuery?.statementId;
    if (statementId == null) return;
    modifySessionScripts({
        type: SET_SCRIPT_TEXT,
        value: {
            scriptKey: script.scriptKey,
            text: script.scriptSession.rewriteVisCard(
                statementId,
                placement.row,
                placement.column,
                placement.width,
                placement.height,
            ),
        },
    });
}
