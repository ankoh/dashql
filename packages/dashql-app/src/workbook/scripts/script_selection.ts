import * as React from 'react';

import type { Runtime } from '@ankoh/dashql/runtime/runtime';
import { Store } from '@ankoh/dashql/runtime/store/store';
import type { ScriptRef } from '@ankoh/dashql/platform/workbook/scripts/script_types';
import type { ModifyWorkbookScripts, ScriptKey, WorkbookScripts } from '@ankoh/dashql/platform/workbook/scripts/workbook_scripts';

import { useOptionalRuntime } from '../../runtime/runtime_hooks.js';
import { useStoreState } from '../../utils/store_hooks.js';

/// The selected script of every workbook (workbookId -> script key). A state of the app, the workbook scripts of the
/// runtime don't know it: the feed, the commands of a workbook and the editors follow it. Keyed by the script key, a
/// selected script stays selected when it is renamed or moves to another connection. Whoever creates or deletes a
/// script moves the selection: a created script is selected (`createdScriptRef`), a deleted one passes it to the
/// script before it (`deleteScript`).
export type ScriptSelectionState = ReadonlyMap<string, ScriptKey>;

/// The selected script of a workbook. Without a selection, or when the selected script is gone, the first script.
export function selectedScriptRef(workbook: Pick<WorkbookScripts, 'scriptKeys' | 'scriptOrder' | 'scriptRefs'>, selected: ScriptKey | null | undefined): ScriptRef | undefined {
    const index = selected == null ? -1 : workbook.scriptKeys.indexOf(selected);
    const fileName = index < 0 ? undefined : workbook.scriptOrder[index];
    const ref = fileName == null ? undefined : workbook.scriptRefs[fileName];
    if (ref != null) return ref;
    const first = workbook.scriptOrder[0];
    return first == null ? undefined : workbook.scriptRefs[first];
}

/// The script that a `createScript` added to a workbook
export function createdScriptRef(prev: Pick<WorkbookScripts, 'scriptRefs'>, next: Pick<WorkbookScripts, 'scriptOrder' | 'scriptRefs'>): ScriptRef | undefined {
    const created = next.scriptOrder.find(fileName => prev.scriptRefs[fileName] == null);
    return created == null ? undefined : next.scriptRefs[created];
}

/// The selected scripts of the workbooks of a runtime
export class ScriptSelection {
    readonly store = new Store<ScriptSelectionState>(new Map());

    /// Select a script of a workbook
    select = (workbookId: string, scriptKey: ScriptKey): void => {
        this.store.update(prev => prev.get(workbookId) === scriptKey ? prev : new Map(prev).set(workbookId, scriptKey));
    };

    /// Select the script with a file name, a file name that the workbook doesn't have changes nothing
    selectFile = (workbook: WorkbookScripts, fileName: string): void => {
        const ref = workbook.scriptRefs[fileName];
        if (ref != null) this.select(workbook.workbookId, ref.scriptId);
    };

    /// Select the next or the previous script of a workbook, the first or the last one stays selected
    selectNeighbor = (workbook: WorkbookScripts, step: 1 | -1): void => {
        const files = workbook.scriptOrder;
        const current = this.selectedRef(workbook);
        const index = current == null ? -1 : files.indexOf(current.fileName);
        const neighbor = files[Math.min(Math.max(Math.max(index, 0) + step, 0), files.length - 1)];
        if (neighbor != null) this.selectFile(workbook, neighbor);
    };

    /// The selected script of a workbook
    selectedRef = (workbook: WorkbookScripts): ScriptRef | undefined =>
        selectedScriptRef(workbook, this.store.current.get(workbook.workbookId));

    /// Forget the selection of a workbook, e.g. of a deleted one
    forget = (workbookId: string): void => {
        if (!this.store.current.has(workbookId)) return;
        this.store.update(state => {
            const copy = new Map(state);
            copy.delete(workbookId);
            return copy;
        });
    };
}

/// Delete a script of a workbook. A selected script passes the selection to the script before it, the first script to
/// the script after it.
export function deleteScript(selection: ScriptSelection, workbook: WorkbookScripts, modify: ModifyWorkbookScripts, fileName: string): ReturnType<ModifyWorkbookScripts> {
    if (selection.selectedRef(workbook)?.fileName === fileName) {
        const index = workbook.scriptOrder.indexOf(fileName);
        const remaining = workbook.scriptOrder.filter(name => name !== fileName);
        const next = remaining[Math.max(0, index - 1)];
        if (next == null) selection.forget(workbook.workbookId);
        else selection.selectFile(workbook, next);
    }
    return modify({ kind: 'deleteScript', value: { fileName } });
}

/// The selections of the runtimes, one per runtime
const SELECTIONS = new WeakMap<Runtime, ScriptSelection>();
/// The selection of components without a runtime, e.g. in tests that render a single component
const DETACHED_SELECTION = new ScriptSelection();

/// The script selection of a runtime
export function scriptSelectionOf(runtime: Runtime | null): ScriptSelection {
    if (runtime == null) return DETACHED_SELECTION;
    let selection = SELECTIONS.get(runtime);
    if (selection == null) {
        selection = new ScriptSelection();
        SELECTIONS.set(runtime, selection);
    }
    return selection;
}

/// The script selection of the app, without subscribing to it
export function useScriptSelection(): ScriptSelection {
    return scriptSelectionOf(useOptionalRuntime());
}

/// The selected script of a workbook, null without a workbook
export function useSelectedScriptRef(workbook: WorkbookScripts | null): ScriptRef | undefined {
    const selection = useScriptSelection();
    const state = useStoreState(selection.store);
    return React.useMemo(
        () => workbook == null ? undefined : selectedScriptRef(workbook, state.get(workbook.workbookId)),
        [workbook, state],
    );
}
