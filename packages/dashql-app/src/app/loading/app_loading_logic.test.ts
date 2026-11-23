import { describe, expect, it, vi } from 'vitest';

import { canShowWorkbook, deleteSurplusEphemeralWorkbooks, selectStartupWorkbook, shouldFinishInitialNavigation } from './app_loading_logic.js';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';

describe('canShowWorkbook', () => {
    it('shows the workbook once the app opened it', () => {
        expect(canShowWorkbook({ phase: 'opened', confirmed: false, pauseAfterSetup: false }, 'offline-workbook')).toBe(true);
        expect(canShowWorkbook({ phase: 'opening', confirmed: false, pauseAfterSetup: false }, 'offline-workbook')).toBe(false);
        expect(canShowWorkbook({ phase: 'failed', confirmed: false, pauseAfterSetup: false }, 'offline-workbook')).toBe(false);
        expect(canShowWorkbook({ phase: 'opened', confirmed: false, pauseAfterSetup: false }, null)).toBe(false);
    });

    it('waits for the confirmation of an app that pauses after its setup', () => {
        expect(canShowWorkbook({ phase: 'opened', confirmed: false, pauseAfterSetup: true }, 'offline-workbook')).toBe(false);
        expect(canShowWorkbook({ phase: 'opened', confirmed: true, pauseAfterSetup: true }, 'offline-workbook')).toBe(true);
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
