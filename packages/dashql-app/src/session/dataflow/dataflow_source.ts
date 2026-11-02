import type * as core from '@ankoh/dashql-core';

import type { ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import { CREATE_SCRIPT, DELETE_SCRIPT, SET_SCRIPT_TEXT, type ScriptData } from '../scripts/session_scripts.js';
import { scriptDisplayName, type FlowPosition } from '../scripts/script_types.js';

/// The placement of the `@flow` tag of a script, null without a tag
function placementOf(flow: FlowPosition | null | undefined): core.DataflowPlacement | null {
    if (flow == null) return null;
    return { position: flow.x != null && flow.y != null ? { x: flow.x, y: flow.y } : null, width: flow.width, height: flow.height };
}

/// Write a placement into the `@flow` tag of a script, the tag is removed if the placement is empty. Returns whether
/// the script has the placement, a script that does not parse or has no statement can't be placed.
function writeFlow(script: ScriptData, placement: core.DataflowPlacement, modifySessionScripts: ModifySessionScripts): boolean {
    const round = (value: number | null | undefined) => (value == null ? null : Math.round(value));
    const next = {
        position: placement.position == null ? null : { x: Math.round(placement.position.x), y: Math.round(placement.position.y) },
        width: round(placement.width),
        height: round(placement.height),
    };
    const empty = next.position == null && next.width == null && next.height == null;
    const current = placementOf(script.annotations.flowPosition);
    const unchanged = current == null
        ? empty
        : current.position?.x === next.position?.x && current.position?.y === next.position?.y
            && (current.width ?? null) === next.width && (current.height ?? null) === next.height;
    if (unchanged) return true;
    let text: string;
    try {
        text = empty ? script.scriptSession.removeVisFlow() : script.scriptSession.rewriteVisFlow(next);
    } catch (e) {
        console.warn('cannot write the placement of the script', e);
        return false;
    }
    modifySessionScripts({ type: SET_SCRIPT_TEXT, value: { scriptKey: script.scriptKey, text } });
    return true;
}

/// Write the position of a script into its `@flow` tag, the size of the box stays. Returns whether the script has
/// the position.
export function persistFlowPosition(script: ScriptData, x: number, y: number, modifySessionScripts: ModifySessionScripts): boolean {
    const current = placementOf(script.annotations.flowPosition);
    return writeFlow(script, { ...current, position: { x, y } }, modifySessionScripts);
}

/// Write the size of a box into the `@flow` tag of its script: its width and the height of its chart, null for the
/// default. The position stays, a box without one is still placed by the layout. Returns whether the script has
/// the size.
export function persistFlowSize(script: ScriptData, width: number | null, height: number | null, modifySessionScripts: ModifySessionScripts): boolean {
    const current = placementOf(script.annotations.flowPosition);
    return writeFlow(script, { position: current?.position ?? null, width, height }, modifySessionScripts);
}

/// Remove the positions from the `@flow` tags of scripts, the layout places them again. The sizes of the boxes stay.
export function removeFlowPositions(scripts: ScriptData[], modifySessionScripts: ModifySessionScripts): void {
    for (const script of scripts) {
        const current = placementOf(script.annotations.flowPosition);
        if (current?.position == null) continue;
        writeFlow(script, { ...current, position: null }, modifySessionScripts);
    }
}

/// The text of a new script, at a position of the canvas if given, a query of the result of `producer` if given
export function newFlowScriptText(position: { x: number; y: number } | null, producer: ScriptData | null, quoteIdentifier: (name: string) => string): string {
    const tag = position != null ? `/** @flow x=${Math.round(position.x)} y=${Math.round(position.y)} */\n` : '';
    if (producer == null) return `${tag}select 1`;
    return `${tag}select * from :${quoteIdentifier(scriptDisplayName(producer.fileName))}`;
}

/// Create a script: a query of the result of `producer` on its connection, or a query on the connection of the last
/// script. A script without a position is placed by the layout, one that reads `producer` right of it.
export function createFlowScript(
    position: { x: number; y: number } | null,
    producer: ScriptData | null,
    quoteIdentifier: (name: string) => string,
    modifySessionScripts: ModifySessionScripts,
): ReturnType<ModifySessionScripts> {
    return modifySessionScripts({
        type: CREATE_SCRIPT,
        value: {
            index: null,
            text: newFlowScriptText(position, producer, quoteIdentifier),
            ...(producer != null ? { connection: producer.connection } : {}),
        },
    });
}

/// Delete a script
export function deleteFlowScript(script: ScriptData, modifySessionScripts: ModifySessionScripts): void {
    modifySessionScripts({ type: DELETE_SCRIPT, value: script.fileName });
}
