import { describe, expect, it, vi } from 'vitest';

import { loadApp, selectStartupNotebook } from './app_loading_logic.js';

describe('selectStartupNotebook', () => {
    it('prefers a valid notebook requested by the URL', () => {
        expect(selectStartupNotebook(['first', 'requested'], 'first', 'requested')).toBe('requested');
    });

    it('prefers a valid last-opened notebook', () => {
        expect(selectStartupNotebook(['first', 'last'], 'last')).toBe('last');
    });

    it('falls back to the first restored notebook', () => {
        expect(selectStartupNotebook(['first', 'second'], 'missing')).toBe('first');
    });

    it('returns null when no valid notebook was restored', () => {
        expect(selectStartupNotebook([], 'missing')).toBeNull();
    });
});

describe('loadApp', () => {
    it('restores empty state without creating a connection or notebook', async () => {
        const restored = {
            connectionStates: new Map(),
            attachedDatabasesByNotebook: new Map(),
            connectionStatesByType: [[], [], [], []],
            connectionSignatures: new Map(),
            notebookScripts: new Map(),
            notebookScriptsByConnection: new Map(),
            notebookScriptsByConnectionType: [[], [], [], []],
            invalidNotebooks: new Map(),
        };
        const storage = { restoreAppState: vi.fn().mockResolvedValue(restored) };
        const resetConnections = vi.fn();
        const resetNotebookScripts = vi.fn();
        const logger = {
            childSpan: () => ({
                info: vi.fn(),
            }),
        };

        const result = await loadApp(
            logger as any,
            {} as any,
            storage as any,
            resetConnections,
            resetNotebookScripts,
            vi.fn(),
        );

        expect(resetConnections).toHaveBeenCalledOnce();
        expect(resetConnections.mock.calls[0][0].attachedDatabases.size).toBe(0);
        expect(resetNotebookScripts).toHaveBeenCalledOnce();
        expect(resetNotebookScripts.mock.calls[0][0].notebookScriptsMap.size).toBe(0);
        expect(result.invalidNotebooks.size).toBe(0);
        expect(result.restoredNotebookIds).toEqual([]);
    });

    it('preserves restored notebook manifest order for startup selection', async () => {
        const restored = {
            connectionStates: new Map(),
            attachedDatabasesByNotebook: new Map(),
            connectionStatesByType: [[], [], [], []],
            connectionSignatures: new Map(),
            notebookScripts: new Map([['second', {}], ['first', {}]]),
            notebookScriptsByConnection: new Map(),
            notebookScriptsByConnectionType: [[], [], [], []],
            invalidNotebooks: new Map(),
        };
        const result = await loadApp(
            { childSpan: () => ({ info: vi.fn() }) } as any,
            {} as any,
            { restoreAppState: vi.fn().mockResolvedValue(restored) } as any,
            vi.fn(),
            vi.fn(),
            vi.fn(),
        );
        expect(result.restoredNotebookIds).toEqual(['second', 'first']);
        expect(selectStartupNotebook(result.restoredNotebookIds, undefined)).toBe('second');
    });
});
