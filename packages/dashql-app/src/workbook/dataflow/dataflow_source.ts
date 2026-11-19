import type * as core from '@akohn/dashql';

import type { ModifyWorkbookScripts, ScriptData, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { createScriptAction } from '../scripts/script_creation.js';
import { scriptDisplayName, type FlowPosition } from '@akohn/dashql/platform/workbook/script_types';
import { quoteIdentifier } from '@akohn/dashql/platform/utils/sql_quote';

/// The placement of the `@flow` tag of a script, null without a tag
function placementOf(flow: FlowPosition | null | undefined): core.DataflowPlacement | null {
    if (flow == null) return null;
    return { position: flow.x != null && flow.y != null ? { x: flow.x, y: flow.y } : null, width: flow.width, height: flow.height };
}

/// Write a placement into the `@flow` tag of a script, the tag is removed if the placement is empty. Returns whether
/// the script has the placement, a script that does not parse or has no statement can't be placed.
function writeFlow(script: ScriptData, placement: core.DataflowPlacement, modifyWorkbookScripts: ModifyWorkbookScripts): boolean {
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
    modifyWorkbookScripts({ kind: 'setScriptText', value: { scriptKey: script.scriptKey, text } });
    return true;
}

/// Write the position and the size of a box into the `@flow` tag of its script at once: its width and the height of
/// its chart, null for the default. Returns whether the script has the placement.
export function persistFlowPlacement(
    script: ScriptData,
    position: { x: number; y: number },
    width: number | null,
    height: number | null,
    modifyWorkbookScripts: ModifyWorkbookScripts,
): boolean {
    return writeFlow(script, { position, width, height }, modifyWorkbookScripts);
}

/// Remove the positions from the `@flow` tags of scripts, the layout places them again. The sizes of the boxes stay.
export function removeFlowPositions(scripts: ScriptData[], modifyWorkbookScripts: ModifyWorkbookScripts): void {
    for (const script of scripts) {
        const current = placementOf(script.annotations.flowPosition);
        if (current?.position == null) continue;
        writeFlow(script, { ...current, position: null }, modifyWorkbookScripts);
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
    workbook: Pick<WorkbookScripts, 'scriptOrder'>,
    position: { x: number; y: number } | null,
    producer: ScriptData | null,
    quoteIdentifier: (name: string) => string,
    modifyWorkbookScripts: ModifyWorkbookScripts,
): ReturnType<ModifyWorkbookScripts> {
    return modifyWorkbookScripts(createScriptAction(workbook, {
        text: newFlowScriptText(position, producer, quoteIdentifier),
        connectionId: producer?.connectionId,
    }));
}

