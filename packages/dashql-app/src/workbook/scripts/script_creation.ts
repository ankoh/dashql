import * as React from 'react';

import { randomScriptName } from './script_name.js';
import { scriptDisplayName, type ScriptRef } from '@akohn/dashql/platform/workbook/script_types';
import type { ScriptData, WorkbookAction, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';

import { useOptionalRuntime } from '../../runtime/runtime_hooks.js';
import { createdScriptRef, type ScriptSelection } from './script_selection.js';

/// What a new script starts with
export interface NewScript {
    /// The index of the feed, appended without one
    index?: number | null;
    /// The text, the default text without one
    text?: string;
    /// The connection, the one of the neighbors of the script without one
    connectionId?: string | null;
}

/// The action that creates a script of a workbook. The base of its file name is random, the runtime makes it unique.
export function createScriptAction(workbook: Pick<WorkbookScripts, 'scriptOrder'>, script: NewScript): WorkbookAction {
    const base = randomScriptName(new Set(workbook.scriptOrder.map(scriptDisplayName)));
    return {
        kind: 'createScript',
        value: {
            index: script.index ?? undefined,
            text: script.text,
            base,
            ...(script.connectionId != null ? { connectionId: script.connectionId } : {}),
        },
    };
}

/// Read a workbook as the runtime holds it now, e.g. right after an action: the store takes the changes first
export function useLiveWorkbookReader(): (workbookId: string) => WorkbookScripts | null {
    const runtime = useOptionalRuntime();
    return React.useCallback((workbookId: string) => {
        if (runtime == null) return null;
        runtime.flush();
        return runtime.store.get('workbook', workbookId);
    }, [runtime]);
}

/// Read a script as the runtime holds it now, e.g. the file name of a renamed script: the store takes the changes first
export function useLiveScriptReader(): (scriptKey: number) => ScriptData | null {
    const runtime = useOptionalRuntime();
    return React.useCallback((scriptKey: number) => {
        if (runtime == null) return null;
        runtime.flush();
        return runtime.store.get('script', scriptKey);
    }, [runtime]);
}

/// Select the script that an action added to a workbook, returns it
export function selectCreatedScript(
    selection: ScriptSelection,
    prev: Pick<WorkbookScripts, 'scriptRefs'>,
    next: WorkbookScripts | null,
): ScriptRef | undefined {
    const created = next == null ? undefined : createdScriptRef(prev, next);
    if (next != null && created != null) selection.select(next.workbookId, created.scriptId);
    return created;
}
