import { describe, it, expect } from 'vitest';
import { WorkbookScriptsRegistry, addWorkbookScriptsForConnection, removeWorkbookScriptsFromRegistry } from './workbook_scripts_registry_state.js';
import { WorkbookScripts } from './workbook_scripts.js';

// removeWorkbookScriptsFromRegistry only reads workbookScriptsMap and the connections of the scripts,
// so a tiny stand-in WorkbookScripts is enough — no Wasm needed.
function scripts(workbookId: string, connectionId: string = `connection-${workbookId}`): WorkbookScripts {
    return { workbookId, pendingConnection: { connectionId }, scripts: {}, scriptRefs: {}, scriptOrder: [] } as unknown as WorkbookScripts;
}

function registry(workbookIds: string[]): WorkbookScriptsRegistry {
    const reg: WorkbookScriptsRegistry = {
        workbookScriptsMap: new Map(),
        workbookScriptsByConnection: new Map(),
        invalidWorkbooks: new Map(),
    };
    for (const workbookId of workbookIds) {
        reg.workbookScriptsMap.set(workbookId, scripts(workbookId));
        addWorkbookScriptsForConnection(reg, `connection-${workbookId}`, workbookId);
    }
    return reg;
}

describe('removeWorkbookScriptsFromRegistry', () => {
    it('drops the entry from both indices', () => {
        const reg = registry(['a']);
        const next = removeWorkbookScriptsFromRegistry(reg, 'a');

        expect(next.workbookScriptsMap.has('a')).toBe(false);
        expect(next.workbookScriptsByConnection.has('connection-a')).toBe(false);
    });

    it('leaves the given registry unchanged', () => {
        const reg = registry(['a', 'b']);
        const next = removeWorkbookScriptsFromRegistry(reg, 'a');

        expect(next.workbookScriptsMap).not.toBe(reg.workbookScriptsMap);
        expect(reg.workbookScriptsMap.has('a')).toBe(true);
        expect(reg.workbookScriptsByConnection.get('connection-a')).toEqual(['a']);
    });

    it('leaves sibling workbooks intact', () => {
        const reg = registry(['a', 'b']);
        const next = removeWorkbookScriptsFromRegistry(reg, 'a');

        expect(next.workbookScriptsMap.has('a')).toBe(false);
        expect(next.workbookScriptsMap.has('b')).toBe(true);
        expect(next.workbookScriptsByConnection.get('connection-b')).toEqual(['b']);
    });

    it('is a no-op for an unknown workbook id (returns the same reference)', () => {
        const reg = registry(['a']);
        const next = removeWorkbookScriptsFromRegistry(reg, 'missing');

        expect(next).toBe(reg);
        expect(next.workbookScriptsMap.has('a')).toBe(true);
    });

    it('keeps the other workbooks of a shared connection', () => {
        const reg = registry([]);
        for (const workbookId of ['a', 'b']) {
            reg.workbookScriptsMap.set(workbookId, scripts(workbookId, 'shared'));
            addWorkbookScriptsForConnection(reg, 'shared', workbookId);
        }
        expect(reg.workbookScriptsByConnection.get('shared')).toEqual(['a', 'b']);
        const next = removeWorkbookScriptsFromRegistry(reg, 'a');
        expect(next.workbookScriptsByConnection.get('shared')).toEqual(['b']);
        const last = removeWorkbookScriptsFromRegistry(next, 'b');
        expect(last.workbookScriptsByConnection.has('shared')).toBe(false);
    });
});
