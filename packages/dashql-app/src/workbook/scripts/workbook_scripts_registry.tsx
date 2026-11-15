import * as React from 'react';

import { CONNECTOR_INFOS, type ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import type { InvalidWorkbook, WorkbookValidationError } from '@ankoh/dashql-runtime/storage/workbook_validation';
import type {
    ModifyWorkbookScripts,
    ScriptData,
    ScriptDataMap,
    WorkbookAction,
    WorkbookDerived,
    WorkbookScripts,
} from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import type * as core from '@ankoh/dashql-core';

import { useScriptSelection } from './script_selection.js';
import { useOptionalCoreRuntime, useView } from '../../runtime/runtime_hooks.js';

// The workbooks are a domain of the runtime of the module (docs/wip/runtime_api.md). A component reads the slice it
// shows: a workbook, a script, the derived view of a workbook or the list of the workbooks, and renders again when that
// slice changes. A keystroke changes the slice of its script and the derived view of its workbook, not the workbook.
// The hooks that only dispatch don't subscribe; they resolve the runtime when their function is called, a test may
// render a component without the runtime as long as it doesn't call them.

const NO_SUBSCRIPTION = () => () => { };

/// The runtime of the module, resolved when a function of a hook is called
function useLazyRuntime() {
    const runtime = useOptionalCoreRuntime();
    return React.useCallback(() => {
        if (runtime == null) throw new Error('the workbooks need a RuntimeProvider');
        return runtime;
    }, [runtime]);
}

/// A workbook and the dispatch of its actions
export function useWorkbookScripts(id: string | null | undefined): [WorkbookScripts | null, ModifyWorkbookScripts] {
    const workbook = useView('workbook', id);
    const runtime = useLazyRuntime();
    const dispatch = React.useCallback((action: WorkbookAction): core.DispatchOutcome => {
        if (id == null) return { ok: false, changed: false, error: 'no workbook', id: null };
        return runtime().dispatchWorkbook(id, action);
    }, [id, runtime]);
    return [workbook, dispatch];
}

/// A script of a workbook by its key
export function useScript(scriptKey: number | null | undefined): ScriptData | null {
    return useView('script', scriptKey);
}

/// What the runtime derives from the scripts of a workbook: the checked references, the dataflow and the inputs
export function useWorkbookDerived(workbookId: string | null | undefined): WorkbookDerived | null {
    return useView('workbookDerived', workbookId);
}

/// The scripts of a workbook by key. The component renders again when a script of the workbook changes, e.g. with
/// every keystroke: only the views that show all scripts at once use it.
export function useWorkbookScriptMap(workbookId: string | null | undefined): ScriptDataMap {
    const runtime = useOptionalCoreRuntime();
    const store = runtime?.store ?? null;
    const cache = React.useRef<{ keys: readonly number[] | null; scripts: (ScriptData | null)[]; map: ScriptDataMap }>({ keys: null, scripts: [], map: {} });
    const subscribe = React.useMemo(() => {
        if (store == null || workbookId == null) return NO_SUBSCRIPTION;
        return (listener: () => void) => {
            const unsubscribeWorkbook = store.subscribe('workbook', workbookId, listener);
            const unsubscribeScripts = store.subscribeKind('script', listener);
            return () => {
                unsubscribeWorkbook();
                unsubscribeScripts();
            };
        };
    }, [store, workbookId]);
    const getSnapshot = React.useCallback((): ScriptDataMap => {
        const keys = workbookId == null ? null : store?.get('workbook', workbookId)?.scriptKeys ?? null;
        const scripts = (keys ?? []).map(key => store?.get('script', key) ?? null);
        const held = cache.current;
        if (held.keys === keys && held.scripts.length === scripts.length && scripts.every((script, i) => script === held.scripts[i])) {
            return held.map;
        }
        const map: ScriptDataMap = {};
        for (const script of scripts) {
            if (script != null) map[script.scriptKey] = script;
        }
        cache.current = { keys, scripts, map };
        return map;
    }, [store, workbookId]);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/// The workbooks by id, in the order they were registered. The component renders again when a workbook changes, not
/// with the changes of the scripts.
export function useWorkbooks(): ReadonlyMap<string, WorkbookScripts> {
    const runtime = useOptionalCoreRuntime();
    const store = runtime?.store ?? null;
    const subscribe = React.useMemo(() => store == null ? NO_SUBSCRIPTION : (listener: () => void) => store.subscribeKind('workbook', listener), [store]);
    const getSnapshot = React.useCallback(() => store?.all('workbook') ?? NO_WORKBOOKS, [store]);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
const NO_WORKBOOKS: ReadonlyMap<string, WorkbookScripts> = new Map();

/// Read a workbook of the last flush without subscribing to it
export function useWorkbookReader(): (workbookId: string) => WorkbookScripts | null {
    const runtime = useLazyRuntime();
    return React.useCallback((workbookId: string) => runtime().workbook(workbookId), [runtime]);
}

/// The list of the workbooks: their ids in the order they were registered with their names, and the workbooks that were
/// refused a load
export function useWorkbookList(): core.WorkbookListView | null {
    return useView('workbookList', 'root');
}

/// Apply an action to any workbook without subscribing to it
export function useWorkbookScriptsDispatch(): (id: string, action: WorkbookAction) => core.DispatchOutcome {
    const runtime = useLazyRuntime();
    return React.useCallback((id: string, action: WorkbookAction) => runtime().dispatchWorkbook(id, action), [runtime]);
}

/// The workbooks that were refused a load
export interface InvalidWorkbooks {
    /// The invalid workbooks (workbookId -> reason)
    invalidWorkbooks: ReadonlyMap<string, InvalidWorkbook>;
    /// Delete the files of an invalid workbook and drop it from the list
    deleteInvalidWorkbook: (workbookId: string) => Promise<void>;
}

const NO_INVALID_WORKBOOKS: ReadonlyMap<string, InvalidWorkbook> = new Map();

/// The workbooks that were refused a load, from the list of the workbooks
export function useInvalidWorkbooks(): InvalidWorkbooks {
    const runtime = useLazyRuntime();
    const list = useWorkbookList();
    const invalid = list?.invalidWorkbooks;
    const invalidWorkbooks = React.useMemo(() => {
        if (invalid == null || invalid.length === 0) return NO_INVALID_WORKBOOKS;
        return new Map(invalid.map(workbook => [workbook.workbookId, {
            workbookId: workbook.workbookId,
            title: workbook.title,
            connectorType: workbook.connectorType as ConnectorType | null,
            error: workbook.error as WorkbookValidationError,
        }]));
    }, [invalid]);
    const deleteInvalidWorkbook = React.useCallback((workbookId: string) => runtime().deleteInvalidWorkbook(workbookId), [runtime]);
    return React.useMemo(() => ({ invalidWorkbooks, deleteInvalidWorkbook }), [invalidWorkbooks, deleteInvalidWorkbook]);
}

/// Create a workbook without scripts on a connection and write its first manifest, returns its view
export function useWorkbookScriptsCreation(): (connectionId: string, name: string, ephemeral: boolean) => WorkbookScripts {
    const runtime = useLazyRuntime();
    return React.useCallback((connectionId: string, name: string, ephemeral: boolean) => {
        const core = runtime();
        const connectorType = core.connection(connectionId)?.connectorType as ConnectorType | undefined;
        const originalFileName = connectorType == null ? undefined : CONNECTOR_INFOS[connectorType]?.names.fileShort;
        return core.createWorkbook(connectionId, name, ephemeral, originalFileName);
    }, [runtime]);
}

/// Drop a workbook from the runtime, its scripts leave the catalogs of their connections. The selection of the app
/// forgets it.
export function useWorkbookScriptsDeletion(): (workbookId: string) => void {
    const runtime = useLazyRuntime();
    const selection = useScriptSelection();
    return React.useCallback((workbookId: string) => {
        runtime().deleteWorkbook(workbookId);
        selection.forget(workbookId);
    }, [runtime, selection]);
}
