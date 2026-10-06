import type { ModifyNotebookScripts } from '../scripts/notebook_scripts_registry.js';
import { SET_SCRIPT_TEXT, type ScriptData } from '../scripts/notebook_scripts.js';
import type { DashboardPlacement } from './dashboard_layout.js';

export function persistDashboardPlacement(
    script: ScriptData,
    placement: DashboardPlacement,
    modifyNotebookScripts: ModifyNotebookScripts,
): void {
    modifyNotebookScripts({
        type: SET_SCRIPT_TEXT,
        value: {
            scriptKey: script.scriptKey,
            text: script.scriptSession.rewriteDashboard(
                placement.row,
                placement.column,
                placement.width,
                placement.height,
            ),
        },
    });
}
