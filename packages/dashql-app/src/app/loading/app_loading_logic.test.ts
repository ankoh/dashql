import { describe, expect, it, vi } from 'vitest';

import { canShowSession, deleteSurplusEphemeralSessions, loadApp, selectStartupSession, shouldFinishInitialNavigation } from './app_loading_logic.js';
import type { SessionScripts } from '../../session/scripts/session_scripts.js';
import { AppLoadingStatus } from './app_loading_status.js';
import { SessionSetupStatus } from './session_setup_status.js';

describe('canShowSession', () => {
    it.each([SessionSetupStatus.OPENING, SessionSetupStatus.CONFIGURING, SessionSetupStatus.NONE])('shows an opened session without waiting for connection setup (%s)', sessionSetupStatus => {
        expect(canShowSession({
            appLoadingStatus: AppLoadingStatus.SETUP_DONE,
            sessionId: 'offline-session',
            sessionSetupStatus,
            confirmedFinishedSetup: false,
        }, false)).toBe(true);
    });
});

function session(sessionId: string, ephemeral: boolean = false): SessionScripts {
    return { sessionId, sessionMetadata: ephemeral ? { ephemeral } : {} } as SessionScripts;
}

describe('selectStartupSession', () => {
    const restored = new Map([session('first'), session('second'), session('greeter', true)].map(s => [s.sessionId, s]));

    it('selects the restored session of the path', () => {
        expect(selectStartupSession('second', restored)).toBe('second');
    });

    it('does not fall back to a restored session without a path', () => {
        expect(selectStartupSession(null, restored)).toBeNull();
    });

    it('ignores an unknown session and the path of the ephemeral session', () => {
        expect(selectStartupSession('unknown', restored)).toBeNull();
        expect(selectStartupSession('greeter', restored)).toBeNull();
    });
});

describe('deleteSurplusEphemeralSessions', () => {
    it('keeps a single ephemeral session and the full sessions', async () => {
        const deleteSession = vi.fn(async () => { });
        await deleteSurplusEphemeralSessions([session('first'), session('greeter', true)], deleteSession, vi.fn());
        expect(deleteSession).not.toHaveBeenCalled();
    });

    it('keeps the first of several ephemeral sessions in restore order', async () => {
        const deleteSession = vi.fn(async () => { });
        await deleteSurplusEphemeralSessions([session('a'), session('kept', true), session('b', true), session('c', true)], deleteSession, vi.fn());
        expect(deleteSession.mock.calls).toEqual([['b'], ['c']]);
    });

    it('reports a failed deletion and goes on', async () => {
        const failure = new Error('locked');
        const deleteSession = vi.fn(async (sessionId: string) => {
            if (sessionId === 'b') throw failure;
        });
        const onFailure = vi.fn();
        await deleteSurplusEphemeralSessions([session('kept', true), session('b', true), session('c', true)], deleteSession, onFailure);
        expect(onFailure.mock.calls).toEqual([['b', failure]]);
        expect(deleteSession).toHaveBeenCalledWith('c');
    });
});

describe('shouldFinishInitialNavigation', () => {
    it('does not replace navigation after an initial shared session was opened', async () => {
        await expect(shouldFinishInitialNavigation(Promise.resolve(true))).resolves.toBe(false);
    });

    it('finishes fallback navigation when the initial shared session was not opened', async () => {
        await expect(shouldFinishInitialNavigation(Promise.resolve(false))).resolves.toBe(true);
    });

    it('finishes normal startup navigation without an inline setup', async () => {
        await expect(shouldFinishInitialNavigation(null)).resolves.toBe(true);
    });
});

describe('loadApp', () => {
    it('restores empty state without creating a connection or session', async () => {
        const restored = {
            connectionStates: new Map(),
            attachedDatabasesBySession: new Map(),
            connectionStatesByType: [[], [], [], []],
            sessionScripts: new Map(),
            sessionScriptsByConnection: new Map(),
            invalidSessions: new Map(),
        };
        const storage = { restoreAppState: vi.fn().mockResolvedValue(restored) };
        const resetConnections = vi.fn();
        const resetSessionScripts = vi.fn();
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
            resetSessionScripts,
            vi.fn(),
        );

        expect(resetConnections).toHaveBeenCalledOnce();
        expect(resetConnections.mock.calls[0][0].connections.size).toBe(0);
        expect(resetSessionScripts).toHaveBeenCalledOnce();
        expect(resetSessionScripts.mock.calls[0][0].sessionScriptsMap.size).toBe(0);
        expect(result.invalidSessions.size).toBe(0);
        expect(result.restoredSessions.size).toBe(0);
    });

    it('preserves the restored session manifest order', async () => {
        const restored = {
            connectionStates: new Map(),
            attachedDatabasesBySession: new Map(),
            connectionStatesByType: [[], [], [], []],
            sessionScripts: new Map([['second', {}], ['first', {}]]),
            sessionScriptsByConnection: new Map(),
            invalidSessions: new Map(),
        };
        const result = await loadApp(
            { childSpan: () => ({ info: vi.fn() }) } as any,
            {} as any,
            { restoreAppState: vi.fn().mockResolvedValue(restored) } as any,
            vi.fn(),
            vi.fn(),
            vi.fn(),
        );
        expect([...result.restoredSessions.keys()]).toEqual(['second', 'first']);
    });
});
