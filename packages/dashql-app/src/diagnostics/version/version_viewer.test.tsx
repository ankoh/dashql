import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@akohn/dashql/platform/logger/logger';
import { DASHQL_VERSION } from '../../globals.js';
import { LoggerProvider, useLogger } from '../../host/logger_provider.js';
import { ElectronVersionCheck } from '../../host/version/electron_version_check.js';
import { useVersionCheck } from '../../host/version/version_check.js';
import { detectReleaseChannel, WebVersionCheck } from '../../host/version/web_version_check.js';
import { VERSION_CHECK_INTERVAL_MS, VersionInfoOverlay } from './version_viewer.js';

const manifest = {
    release_id: 'release-id',
    pub_date: '2026-08-30T12:26:06Z',
    version: '0.0.8',
    git_commit_hash: 'e0e35fe',
    git_commit_url: 'https://github.com/ankoh/dashql/tree/e0e35fe',
    update_manifest_url: 'https://get.dashql.app/releases/0.0.8/update.json',
    bundles: [],
};

function renderAnchor(props: object) {
    return <button {...props}>Version</button>;
}

function LoggerProbe(props: {onLogger: (logger: Logger) => void}) {
    props.onLogger(useLogger());
    return null;
}

function RefreshState(props: {onChange: (refreshing: boolean) => void}) {
    const state = useVersionCheck().refresh;
    const refreshing = state?.isRefreshing ?? false;
    const onChange = React.useEffectEvent(props.onChange);
    React.useEffect(() => onChange(refreshing), [refreshing]);
    return null;
}

describe('VersionInfoOverlay', () => {
    let container: HTMLDivElement;
    let root: Root;
    let now: number;
    let fetchManifest: ReturnType<typeof vi.fn>;
    let isRefreshing: boolean;
    let logger: Logger;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        now = 1000;
        isRefreshing = false;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        fetchManifest = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(manifest))));
        vi.stubGlobal('fetch', fetchManifest);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    async function render(open: boolean, native = false) {
        const CheckProvider = native ? ElectronVersionCheck : WebVersionCheck;
        await act(async () => {
            root.render(
                <LoggerProvider>
                    <CheckProvider>
                        <>
                            <LoggerProbe onLogger={next => { logger = next; }} />
                            <RefreshState onChange={refreshing => { isRefreshing = refreshing; }} />
                            <VersionInfoOverlay isOpen={open} onClose={() => {}} renderAnchor={renderAnchor} />
                        </>
                    </CheckProvider>
                </LoggerProvider>,
            );
        });
    }

    async function settleRefresh() {
        await vi.waitFor(() => expect(isRefreshing).toBe(false));
    }

    it('checks on first open, then only after the check interval since the overlay last checked', async () => {
        await render(false);
        // A check fetches the manifest of every channel
        const perCheck = fetchManifest.mock.calls.length;
        expect(perCheck).toBeGreaterThan(0);
        await settleRefresh();

        await render(true);
        expect(fetchManifest).toHaveBeenCalledTimes(2 * perCheck);
        await settleRefresh();

        await render(false);
        now += VERSION_CHECK_INTERVAL_MS - 1;
        await render(true);
        expect(fetchManifest).toHaveBeenCalledTimes(2 * perCheck);

        await render(false);
        now += 1;
        await render(true);
        expect(fetchManifest).toHaveBeenCalledTimes(3 * perCheck);
    });

    it('shows a busy indicator until both channels finish and ignores overlapping clicks', async () => {
        await render(false);
        await settleRefresh();
        const perCheck = fetchManifest.mock.calls.length;
        let resolveStable!: (response: Response) => void;
        let resolveLatest!: (response: Response) => void;
        fetchManifest
            .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveStable = resolve; }))
            .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveLatest = resolve; }));

        await render(true);
        const refreshButton = () => document.querySelector<HTMLButtonElement>('[data-testid="version-check-refresh"]');
        expect(refreshButton()).not.toBeNull();
        expect(refreshButton()!.getAttribute('aria-disabled'), 'busy while both channels load').toBe('true');
        expect(fetchManifest).toHaveBeenCalledTimes(2 * perCheck);

        act(() => refreshButton()!.click());
        expect(fetchManifest).toHaveBeenCalledTimes(2 * perCheck);

        await act(async () => resolveStable(new Response(JSON.stringify(manifest))));
        expect(refreshButton()!.getAttribute('aria-disabled'), 'still busy after stable resolves').toBe('true');

        await act(async () => resolveLatest(new Response(JSON.stringify(manifest))));
        await settleRefresh();
        expect(refreshButton()!.getAttribute('aria-disabled'), 'idle after the latest manifest resolves').not.toBe('true');
        act(() => refreshButton()!.click());
        await act(async () => {});
        expect(fetchManifest).toHaveBeenCalledTimes(3 * perCheck);
        await settleRefresh();
        await render(false);
        await render(true);
        expect(fetchManifest).toHaveBeenCalledTimes(3 * perCheck);
    });

    it('rechecks the Electron updater on first open and after the check interval', async () => {
        const status: DashQLElectronUpdateStatus = {status: 'up-to-date', channel: 'stable', version: '0.0.8'};
        const check = vi.fn().mockResolvedValue(status);
        vi.stubGlobal('dashqlElectron', {
            updates: {
                check,
                getStatus: () => Promise.resolve(status),
                onStatus: () => () => {},
            },
        });

        await render(false, true);
        await settleRefresh();
        expect(check).toHaveBeenCalledTimes(1);
        const perCheck = fetchManifest.mock.calls.length;

        await render(true, true);
        expect(check).toHaveBeenCalledTimes(2);
        expect(fetchManifest).toHaveBeenCalledTimes(2 * perCheck);

        await settleRefresh();
        await render(false, true);
        now += VERSION_CHECK_INTERVAL_MS;
        await render(true, true);
        expect(check).toHaveBeenCalledTimes(3);
        expect(fetchManifest).toHaveBeenCalledTimes(3 * perCheck);
    });

    it('logs an update that fails to download as an error', async () => {
        const channel = detectReleaseChannel(DASHQL_VERSION);
        const status: DashQLElectronUpdateStatus = {status: 'available', channel, version: '999.0.0'};
        fetchManifest.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({...manifest, version: '999.0.0'}))));
        const download = vi.fn().mockRejectedValue(new Error('disk full'));
        vi.stubGlobal('dashqlElectron', {
            updates: {
                check: vi.fn().mockResolvedValue(status),
                getStatus: () => Promise.resolve(status),
                onStatus: () => () => {},
                download,
            },
        });

        await render(true, true);
        await settleRefresh();
        const error = vi.spyOn(logger, 'error');
        const install = () => Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent === 'Install');
        await vi.waitFor(() => expect(install()).toBeDefined());
        act(() => install()!.click());
        await vi.waitFor(() => expect(error).toHaveBeenCalledWith(
            'Failed to download the update',
            {error: expect.stringContaining('disk full')},
            'version_viewer',
        ));
        expect(download).toHaveBeenCalledTimes(1);
    });
});
