import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { ElectronVersionCheck } from '../../platform/version/electron_version_check.js';
import { useVersionCheckRefresh } from '../../platform/version/version_check.js';
import { WebVersionCheck } from '../../platform/version/web_version_check.js';
import { VersionInfoOverlay } from './version_viewer.js';

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

function RefreshState(props: {onChange: (refreshing: boolean) => void}) {
    const state = useVersionCheckRefresh();
    React.useEffect(() => props.onChange(state?.isRefreshing ?? false), [state?.isRefreshing]);
    return null;
}

describe('VersionInfoOverlay', () => {
    let container: HTMLDivElement;
    let root: Root;
    let now: number;
    let fetchManifest: ReturnType<typeof vi.fn>;
    let isRefreshing: boolean;

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

    it('checks on first open, then only after five minutes since the overlay last checked', async () => {
        await render(false);
        expect(fetchManifest).toHaveBeenCalledTimes(2);
        await settleRefresh();

        await render(true);
        expect(fetchManifest).toHaveBeenCalledTimes(4);
        await settleRefresh();

        await render(false);
        now += 5 * 60 * 1000 - 1;
        await render(true);
        expect(fetchManifest).toHaveBeenCalledTimes(4);

        await render(false);
        now += 1;
        await render(true);
        expect(fetchManifest).toHaveBeenCalledTimes(6);
    });

    it('shows a busy indicator until both channels finish and ignores overlapping clicks', async () => {
        await render(false);
        await settleRefresh();
        let resolveStable!: (response: Response) => void;
        let resolveCanary!: (response: Response) => void;
        fetchManifest
            .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveStable = resolve; }))
            .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveCanary = resolve; }));

        await render(true);
        const busyButton = document.querySelector<HTMLButtonElement>('button[aria-label="Checking for updates"]');
        expect(busyButton).not.toBeNull();
        expect(busyButton!.getAttribute('aria-disabled')).toBe('true');
        expect(busyButton!.querySelector('svg'), 'busy button spinner').not.toBeNull();
        expect(fetchManifest).toHaveBeenCalledTimes(4);

        act(() => busyButton!.click());
        expect(fetchManifest).toHaveBeenCalledTimes(4);

        await act(async () => resolveStable(new Response(JSON.stringify(manifest))));
        expect(document.querySelector('button[aria-label="Checking for updates"]'), 'still busy after stable resolves').not.toBeNull();

        await act(async () => resolveCanary(new Response(JSON.stringify(manifest))));
        await settleRefresh();
        const refreshButton = document.querySelector<HTMLButtonElement>('button[aria-label="Check for updates"]');
        expect(refreshButton, 'idle after canary resolves').not.toBeNull();
        act(() => refreshButton!.click());
        await act(async () => {});
        expect(fetchManifest).toHaveBeenCalledTimes(6);
        await settleRefresh();
        await render(false);
        await render(true);
        expect(fetchManifest).toHaveBeenCalledTimes(6);
    });

    it('rechecks the Electron updater on first open and after five minutes', async () => {
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

        await render(true, true);
        expect(check).toHaveBeenCalledTimes(2);
        expect(fetchManifest).toHaveBeenCalledTimes(4);

        await settleRefresh();
        await render(false, true);
        now += 5 * 60 * 1000;
        await render(true, true);
        expect(check).toHaveBeenCalledTimes(3);
        expect(fetchManifest).toHaveBeenCalledTimes(6);
    });
});
