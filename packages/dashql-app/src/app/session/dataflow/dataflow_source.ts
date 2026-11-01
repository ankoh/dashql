import type { ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import { CREATE_SCRIPT, DELETE_SCRIPT, SET_SCRIPT_TEXT, type ScriptData } from '../scripts/session_scripts.js';
import { scriptDisplayName } from '../scripts/script_types.js';

/// Write the position of a script into its `@vis flow` tag
export function persistFlowPosition(script: ScriptData, x: number, y: number, modifySessionScripts: ModifySessionScripts): void {
    const position = script.annotations.flowPosition;
    if (position != null && position.x === Math.round(x) && position.y === Math.round(y)) return;
    let text: string;
    try {
        text = script.scriptSession.rewriteVisFlow(x, y);
    } catch (e) {
        // A script that does not parse or has no statement keeps its position until the next drag
        console.warn('cannot write the position of the script', e);
        return;
    }
    modifySessionScripts({ type: SET_SCRIPT_TEXT, value: { scriptKey: script.scriptKey, text } });
}

/// Remove the `@vis flow` tags of scripts, the layout places them again
export function removeFlowPositions(scripts: ScriptData[], modifySessionScripts: ModifySessionScripts): void {
    for (const script of scripts) {
        if (script.annotations.flowPosition == null) continue;
        let text: string;
        try {
            text = script.scriptSession.removeVisFlow();
        } catch (e) {
            console.warn('cannot remove the position of the script', e);
            continue;
        }
        modifySessionScripts({ type: SET_SCRIPT_TEXT, value: { scriptKey: script.scriptKey, text } });
    }
}

/// The text of a new script at a position of the canvas, a query of the result of `producer` if given
export function newFlowScriptText(x: number, y: number, producer: ScriptData | null, quoteIdentifier: (name: string) => string): string {
    const tag = `/** @vis flow x=${Math.round(x)} y=${Math.round(y)} */\n`;
    if (producer == null) return `${tag}select 1`;
    return `${tag}select * from :${quoteIdentifier(scriptDisplayName(producer.fileName))}`;
}

/// Create a script at a position of the canvas: a query of the result of `producer` on its connection, or an empty
/// query on the connection of the last script
export function createFlowScript(
    x: number,
    y: number,
    producer: ScriptData | null,
    quoteIdentifier: (name: string) => string,
    modifySessionScripts: ModifySessionScripts,
): ReturnType<ModifySessionScripts> {
    return modifySessionScripts({
        type: CREATE_SCRIPT,
        value: {
            index: null,
            text: newFlowScriptText(x, y, producer, quoteIdentifier),
            ...(producer != null ? { connection: producer.connection } : {}),
        },
    });
}

/// Delete a script
export function deleteFlowScript(script: ScriptData, modifySessionScripts: ModifySessionScripts): void {
    modifySessionScripts({ type: DELETE_SCRIPT, value: script.fileName });
}
