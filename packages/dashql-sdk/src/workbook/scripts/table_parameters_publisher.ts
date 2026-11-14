import * as core from '@ankoh/dashql-core';

import { scriptDisplayName } from './script_types.js';
import { planAttachments } from '../attachments/workbook_attachments.js';
import { orderedWorkbookScripts, type WorkbookScripts } from './workbook_scripts.js';

/// The table parameters of every workbook, by workbook id
const REGISTRIES = new Map<string, core.DashQLTableParameters>();

/// The table parameters of a workbook, which the scripts and drafts of the workbook read
export function workbookTableParameters(workbook: WorkbookScripts): core.DashQLTableParameters | null {
    let registry = REGISTRIES.get(workbook.workbookId);
    if (registry == null) {
        // Workbooks without the core, e.g. of tests, have no table parameters
        if (typeof workbook.instance?.createTableParameters !== 'function') return null;
        registry = workbook.instance.createTableParameters();
        REGISTRIES.set(workbook.workbookId, registry);
    }
    return registry;
}

/// Forget the table parameters of a workbook
export function dropWorkbookTableParameters(workbookId: string): void {
    REGISTRIES.get(workbookId)?.destroy();
    REGISTRIES.delete(workbookId);
}

/// Publish the table parameters of a workbook after its scripts or attachments changed. The scripts whose analysis is outdated by
/// them, e.g. those that read a script whose columns changed, are marked outdated and analyzed again.
export function publishTableParameters(prev: WorkbookScripts, next: WorkbookScripts): WorkbookScripts {
    if (prev.scripts === next.scripts && prev.scriptOrder === next.scriptOrder && prev.scriptRefs === next.scriptRefs
        && prev.attachments === next.attachments) {
        return next;
    }
    try {
        const registry = workbookTableParameters(next);
        if (registry == null) return next;
        const scripts = orderedWorkbookScripts(next);
        const outdated = registry.publish(
            scripts.map(script => ({ name: scriptDisplayName(script.fileName), session: script.scriptSession })),
            planAttachments(next.attachments),
        );
        if (outdated.length === 0) return next;
        const marked = { ...next.scripts };
        for (const index of outdated) {
            const script = scripts[index];
            if (script != null && !script.analysisOutdated) marked[script.scriptKey] = { ...script, analysisOutdated: true };
        }
        return { ...next, scripts: marked };
    } catch (e) {
        console.warn('cannot publish the table parameters of the workbook', e);
        return next;
    }
}
