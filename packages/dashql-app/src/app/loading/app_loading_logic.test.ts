import { describe, expect, it, vi } from 'vitest';

import { loadApp } from './app_loading_logic.js';

describe('loadApp', () => {
    it('restores empty state without creating a connection or notebook', async () => {
        const restored = {
            connectionStates: new Map(),
            connectionByNotebook: new Map(),
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
        expect(resetConnections.mock.calls[0][0].connectionMap.size).toBe(0);
        expect(resetNotebookScripts).toHaveBeenCalledOnce();
        expect(resetNotebookScripts.mock.calls[0][0].notebookScriptsMap.size).toBe(0);
        expect(result.invalidNotebooks.size).toBe(0);
    });
});
