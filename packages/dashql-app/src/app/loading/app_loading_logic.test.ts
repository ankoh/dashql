import { describe, expect, it, vi } from 'vitest';

import { canShowWorkbook, deleteSurplusEphemeralWorkbooks, loadApp, selectStartupWorkbook, shouldFinishInitialNavigation } from './app_loading_logic.js';
import type { WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { AppLoadingStatus } from './app_loading_status.js';
import { WorkbookSetupStatus } from './workbook_setup_status.js';

describe('canShowWorkbook', () => {
    it.each([WorkbookSetupStatus.OPENING, WorkbookSetupStatus.CONFIGURING, WorkbookSetupStatus.NONE])('shows an opened workbook without waiting for connection setup (%s)', workbookSetupStatus => {
        expect(canShowWorkbook({
            appLoadingStatus: AppLoadingStatus.SETUP_DONE,
            workbookId: 'offline-workbook',
            workbookSetupStatus,
            confirmedFinishedSetup: false,
        }, false)).toBe(true);
    });
});

function workbook(workbookId: string, ephemeral: boolean = false): WorkbookScripts {
    return { workbookId, ephemeral, workbookMetadata: ephemeral ? { ephemeral } : {} } as WorkbookScripts;
}

describe('selectStartupWorkbook', () => {
    const restored = new Map([workbook('first'), workbook('second'), workbook('greeter', true)].map(s => [s.workbookId, s]));

    it('selects the restored workbook of the path', () => {
        expect(selectStartupWorkbook('second', restored)).toBe('second');
    });

    it('does not fall back to a restored workbook without a path', () => {
        expect(selectStartupWorkbook(null, restored)).toBeNull();
    });

    it('ignores an unknown workbook and the path of the ephemeral workbook', () => {
        expect(selectStartupWorkbook('unknown', restored)).toBeNull();
        expect(selectStartupWorkbook('greeter', restored)).toBeNull();
    });
});

describe('deleteSurplusEphemeralWorkbooks', () => {
    it('keeps a single ephemeral workbook and the full workbooks', async () => {
        const deleteWorkbook = vi.fn(async () => { });
        await deleteSurplusEphemeralWorkbooks([workbook('first'), workbook('greeter', true)], deleteWorkbook, vi.fn());
        expect(deleteWorkbook).not.toHaveBeenCalled();
    });

    it('keeps the first of several ephemeral workbooks in restore order', async () => {
        const deleteWorkbook = vi.fn(async () => { });
        await deleteSurplusEphemeralWorkbooks([workbook('a'), workbook('kept', true), workbook('b', true), workbook('c', true)], deleteWorkbook, vi.fn());
        expect(deleteWorkbook.mock.calls).toEqual([['b'], ['c']]);
    });

    it('reports a failed deletion and goes on', async () => {
        const failure = new Error('locked');
        const deleteWorkbook = vi.fn(async (workbookId: string) => {
            if (workbookId === 'b') throw failure;
        });
        const onFailure = vi.fn();
        await deleteSurplusEphemeralWorkbooks([workbook('kept', true), workbook('b', true), workbook('c', true)], deleteWorkbook, onFailure);
        expect(onFailure.mock.calls).toEqual([['b', failure]]);
        expect(deleteWorkbook).toHaveBeenCalledWith('c');
    });
});

describe('shouldFinishInitialNavigation', () => {
    it('does not replace navigation after an initial shared workbook was opened', async () => {
        await expect(shouldFinishInitialNavigation(Promise.resolve(true))).resolves.toBe(false);
    });

    it('finishes fallback navigation when the initial shared workbook was not opened', async () => {
        await expect(shouldFinishInitialNavigation(Promise.resolve(false))).resolves.toBe(true);
    });

    it('finishes normal startup navigation without an inline setup', async () => {
        await expect(shouldFinishInitialNavigation(null)).resolves.toBe(true);
    });
});

describe('loadApp', () => {
    it('restores empty state without creating a connection or workbook', async () => {
        const restored = {
            connectionIds: [],
            workbooks: new Map(),
            invalidWorkbooks: new Map(),
        };
        const storage = { restoreAppState: vi.fn().mockResolvedValue(restored) };
        const logger = {
            childSpan: () => ({
                info: vi.fn(),
            }),
        };

        const result = await loadApp(
            logger as any,
            storage as any,
            vi.fn(),
        );

        expect(result.restoredConnections).toEqual([]);
        expect(storage.restoreAppState).toHaveBeenCalledOnce();
        expect(result.invalidWorkbooks.size).toBe(0);
        expect(result.restoredWorkbooks.size).toBe(0);
    });

    it('preserves the restored workbook manifest order', async () => {
        const restored = {
            connectionIds: [],
            workbooks: new Map([['second', {}], ['first', {}]]),
            invalidWorkbooks: new Map(),
        };
        const result = await loadApp(
            { childSpan: () => ({ info: vi.fn() }) } as any,
            { restoreAppState: vi.fn().mockResolvedValue(restored) } as any,
            vi.fn(),
        );
        expect([...result.restoredWorkbooks.keys()]).toEqual(['second', 'first']);
    });
});
