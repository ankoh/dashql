import { describe, expect, it, vi } from 'vitest';

import type { WorkbookScripts } from '@ankoh/dashql-platform/workbook/scripts/workbook_scripts';

import { createdScriptRef, deleteScript, ScriptSelection, selectedScriptRef } from './script_selection.js';

/// A workbook with scripts in feed order, the scripts are keyed from 1. Only the names, the keys and the order matter.
function workbook(files: string[], keys: number[] = files.map((_, i) => i + 1)): WorkbookScripts {
    return {
        workbookId: 'workbook',
        scriptKeys: keys.slice(0, files.length),
        scriptRefs: Object.fromEntries(files.map((fileName, i) => [fileName, { scriptId: keys[i], fileName }])),
        scriptOrder: [...files],
    } as unknown as WorkbookScripts;
}

describe('the script selection', () => {
    it('selects the first script without a selection or when the selected script is gone', () => {
        const current = workbook(['a.sql', 'b.sql']);
        expect(selectedScriptRef(current, undefined)?.fileName).toBe('a.sql');
        expect(selectedScriptRef(current, 2)?.fileName).toBe('b.sql');
        expect(selectedScriptRef(current, 9)?.fileName).toBe('a.sql');
        expect(selectedScriptRef(workbook([]), 1)).toBeUndefined();
    });

    it('finds a created script', () => {
        const prev = workbook(['a.sql', 'c.sql'], [1, 3]);
        const next = workbook(['a.sql', 'b.sql', 'c.sql'], [1, 2, 3]);
        expect(createdScriptRef(prev, next)?.scriptId).toBe(2);
        expect(createdScriptRef(next, next)).toBeUndefined();
    });

    it('keeps a renamed script selected', () => {
        const renamed = workbook(['a.sql', 'report.sql']);
        expect(selectedScriptRef(renamed, 2)?.fileName).toBe('report.sql');
    });

    it('passes the selection of a deleted script to the script before it', () => {
        const current = workbook(['a.sql', 'b.sql', 'c.sql']);
        const modify = vi.fn();
        const selection = new ScriptSelection();
        selection.selectFile(current, 'b.sql');
        deleteScript(selection, current, modify, 'b.sql');
        expect(modify).toHaveBeenCalledExactlyOnceWith({ kind: 'deleteScript', value: { fileName: 'b.sql' } });
        expect(selection.store.current.get('workbook')).toBe(1);
        // The first script passes it to the script after it
        selection.selectFile(current, 'a.sql');
        deleteScript(selection, current, modify, 'a.sql');
        expect(selection.store.current.get('workbook')).toBe(2);
        // Deleting another script keeps it, deleting the last script leaves no selection
        selection.selectFile(current, 'c.sql');
        deleteScript(selection, current, modify, 'a.sql');
        expect(selection.store.current.get('workbook')).toBe(3);
        const single = workbook(['a.sql']);
        selection.selectFile(single, 'a.sql');
        deleteScript(selection, single, modify, 'a.sql');
        expect(selection.store.current.has('workbook')).toBe(false);
    });

    it('steps through the scripts and stays at the ends', () => {
        const selection = new ScriptSelection();
        const current = workbook(['a.sql', 'b.sql', 'c.sql']);
        selection.selectNeighbor(current, 1);
        expect(selection.selectedRef(current)?.fileName).toBe('b.sql');
        selection.selectNeighbor(current, 1);
        selection.selectNeighbor(current, 1);
        expect(selection.selectedRef(current)?.fileName).toBe('c.sql');
        selection.selectNeighbor(current, -1);
        expect(selection.selectedRef(current)?.fileName).toBe('b.sql');
        selection.selectFile(current, 'a.sql');
        selection.selectNeighbor(current, -1);
        expect(selection.selectedRef(current)?.fileName).toBe('a.sql');
        // An unknown file changes nothing, selecting the same script keeps the state
        selection.selectFile(current, 'missing.sql');
        expect(selection.selectedRef(current)?.fileName).toBe('a.sql');
        const kept = selection.store.current;
        selection.selectFile(current, 'a.sql');
        expect(selection.store.current).toBe(kept);
        selection.forget('workbook');
        expect(selection.store.current.has('workbook')).toBe(false);
    });
});
