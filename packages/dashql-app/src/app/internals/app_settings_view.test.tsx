import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSettings } from './app_settings_view.js';
import { AppConfigProvider, useAppConfig, type AppConfig } from '../../config/app_config.js';
import { FlavorProvider, useAppFlavor } from '../../config/flavor_provider.js';
import { DASHQL_FLAVOR, FLAVORS, type AppFlavor } from '../../config/flavors.js';
import { LoggerProvider, useLogger } from '../../platform/logger/logger_provider.js';
import { LogLevel } from '../../platform/logger/log_buffer.js';
import type { Logger } from '../../platform/logger/logger.js';
import { APP_RESTART_CTX } from '../../platform/crosstab/app_hand_over.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { QueryResultCacheProvider } from '../../storage/query_result_cache_provider.js';
import { SessionTestBackend } from '../../storage/session_test_backend.js';
import { memoryQueryResultCache } from '../../tests/memory_query_result_cache.js';
import { applyFlavorToDocument } from '../../config/flavor_resolution.js';
import { createTestRoot } from '../../tests/react_root.js';
import { type RouteContext } from '../router/router.js';
import { AppLoadingStatus } from '../loading/app_loading_status.js';
import { SessionSetupStatus } from '../loading/session_setup_status.js';

const SETUP_DONE: RouteContext = {
    appLoadingStatus: AppLoadingStatus.SETUP_DONE,
    confirmedFinishedSetup: true,
    sessionId: null,
    sessionSetupStatus: SessionSetupStatus.NONE,
};

describe('AppSettings', () => {
    let root: ReturnType<typeof createTestRoot>;
    let backend: SessionTestBackend;
    let cache: ReturnType<typeof memoryQueryResultCache>;
    let restart: ReturnType<typeof vi.fn<() => Promise<void>>>;
    let onClose: ReturnType<typeof vi.fn<() => void>>;
    let config: AppConfig | null;
    let flavor: AppFlavor;
    let logger: Logger;
    let routeState: RouteContext | null;

    function Capture() {
        config = useAppConfig();
        flavor = useAppFlavor();
        logger = useLogger();
        routeState = useLocation().state as RouteContext | null;
        return null;
    }

    async function render(requested: AppFlavor | null = null) {
        await root.render(
            <LoggerProvider>
                <FlavorProvider requested={requested}>
                    <AppConfigProvider>
                        <MemoryRouter initialEntries={[{ pathname: '/', state: SETUP_DONE }]}>
                            <StorageProvider backend={backend}>
                                <QueryResultCacheProvider cache={cache}>
                                    <APP_RESTART_CTX.Provider value={restart}>
                                        <>
                                            <Capture />
                                            <AppSettings onClose={onClose} />
                                        </>
                                    </APP_RESTART_CTX.Provider>
                                </QueryResultCacheProvider>
                            </StorageProvider>
                        </MemoryRouter>
                    </AppConfigProvider>
                </FlavorProvider>
            </LoggerProvider>,
        );
        // The config is downloaded from config.json
        await vi.waitFor(() => expect(config).not.toBeNull());
    }

    const settingSwitch = (name: string) => {
        const label = [...root.container.querySelectorAll<HTMLElement>('[id^="app-setting-"]')].find(e => e.textContent?.trim() === name);
        if (label == null) throw new Error(`no setting ${name}`);
        return root.container.querySelector<HTMLButtonElement>(`[role="switch"][aria-labelledby="${label.id}"]`)!;
    };
    const segments = (labelId: string) => [...root.container.querySelectorAll<HTMLButtonElement>(`ul[aria-labelledby="${labelId}"] button`)];
    const selectedSegment = (labelId: string) => segments(labelId).find(b => b.getAttribute('aria-current') === 'true')?.textContent;
    const records = () => [...Array(logger.buffer.length).keys()].map(i => logger.buffer.at(i)!);
    const button = (text: string) => [...root.container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;

    beforeEach(() => {
        root = createTestRoot();
        backend = new SessionTestBackend();
        cache = memoryQueryResultCache();
        restart = vi.fn<() => Promise<void>>(async () => {});
        onClose = vi.fn<() => void>();
        config = null;
        routeState = null;
    });

    afterEach(() => {
        logger?.buffer.setMinLogLevel(LogLevel.Info);
        root.unmount();
        // The flavors brand the document, the other tests expect the default flavor
        applyFlavorToDocument(DASHQL_FLAVOR);
        vi.restoreAllMocks();
    });

    it('toggles the boolean settings', async () => {
        await render();
        const sections = [...root.container.querySelectorAll('section')].map(s => s.getAttribute('aria-label'));
        expect(sections).toEqual(['General', 'Layout', 'Experimental', 'Debugging', 'Login & Setup']);

        const toggles: [string, keyof NonNullable<AppConfig['settings']>][] = [
            ['Narrow Screen Layout', 'narrowScreenLayout'],
            ['Mac Window Layout', 'macWindowLayout'],
            ['Dashboards', 'experimental_dashboards'],
            ['Dataflows', 'experimental_dataflow'],
            ['File Attachments', 'experimental_file_attachments'],
            ['Script Debug Mode', 'scriptDebugMode'],
            ['Table Debug Mode', 'tableDebugMode'],
            ['Formatting Debug Mode', 'formattingDebugMode'],
            ['Force Re-Login', 'forceReLogin'],
        ];
        for (const [name, key] of toggles) {
            const before = config!.settings?.[key] ?? false;
            expect(settingSwitch(name).getAttribute('aria-checked')).toBe(String(before));
            act(() => settingSwitch(name).click());
            expect(config!.settings?.[key]).toBe(!before);
            expect(settingSwitch(name).getAttribute('aria-checked')).toBe(String(!before));
            act(() => settingSwitch(name).click());
            expect(config!.settings?.[key]).toBe(before);
        }
        // The other settings of config.json stay
        expect(config!.settings?.enableTableColumnPlots).toBe(true);
    });

    it('switches the keyword case and the minimum log level', async () => {
        await render();
        expect(selectedSegment('app-setting-keyword-case')).toBe('Lowercase');
        act(() => segments('app-setting-keyword-case')[1].click());
        expect(config!.settings?.keywordCase).toBe('upper');
        expect(selectedSegment('app-setting-keyword-case')).toBe('Uppercase');
        act(() => segments('app-setting-keyword-case')[0].click());
        expect(config!.settings?.keywordCase).toBe('lower');

        expect(selectedSegment('app-setting-min-log-level')).toBe('Info');
        expect(logger.buffer.getMinLogLevel()).toBe(LogLevel.Info);
        act(() => segments('app-setting-min-log-level')[0].click());
        expect(config!.settings?.minLogLevel).toBe(LogLevel.Trace);
        expect(selectedSegment('app-setting-min-log-level')).toBe('Trace');
        expect(logger.buffer.getMinLogLevel()).toBe(LogLevel.Trace);
        act(() => segments('app-setting-min-log-level')[4].click());
        expect(logger.buffer.getMinLogLevel()).toBe(LogLevel.Error);
    });

    it('switches the flavor and layers its settings', async () => {
        await render();
        const flavors = [...FLAVORS.values()];
        expect(segments('app-setting-flavor').map(b => b.textContent)).toEqual(flavors.map(f => f.displayName));
        expect(selectedSegment('app-setting-flavor')).toBe(DASHQL_FLAVOR.displayName);

        const other = flavors.findIndex(f => f.id !== DASHQL_FLAVOR.id);
        act(() => segments('app-setting-flavor')[other].click());
        expect(config!.settings?.flavor).toBe(flavors[other].id);
        for (const [key, value] of Object.entries(flavors[other].settings ?? {})) {
            expect(config!.settings?.[key as keyof NonNullable<AppConfig['settings']>]).toEqual(value);
        }
    });

    it('disables the flavor when the url requests one', async () => {
        const requested = [...FLAVORS.values()].find(f => f.id !== DASHQL_FLAVOR.id)!;
        await render(requested);
        expect(flavor.id).toBe(requested.id);
        expect(segments('app-setting-flavor').every(b => b.disabled)).toBe(true);
        expect(root.container.querySelector('#app-setting-flavor')!.getAttribute('title')).toBe('The flavor is set by the url');
        expect(selectedSegment('app-setting-flavor')).toBe(requested.displayName);
    });

    it('restarts the app to switch the wasm backend once confirmed', async () => {
        await render();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        act(() => settingSwitch('Wasm Backend').click());
        expect(confirm.mock.calls[0][0]).toContain('Enabling the experimental wasm backend restarts the app');
        expect(restart).not.toHaveBeenCalled();
        expect(config!.settings?.experimental_wasm_backend).toBeUndefined();

        confirm.mockReturnValue(true);
        await act(async () => settingSwitch('Wasm Backend').click());
        await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
        // The settings are saved before the restart reloads the tab
        expect((backend.appSettings as AppConfig['settings'])?.experimental_wasm_backend).toBe(true);
        await vi.waitFor(() => expect(config!.settings?.experimental_wasm_backend).toBe(true));
        expect(settingSwitch('Wasm Backend').getAttribute('aria-checked')).toBe('true');
        // The switch stays disabled while the app restarts
        expect(settingSwitch('Wasm Backend').disabled).toBe(true);
    });

    it('enables the switch of the wasm backend again when the restart fails', async () => {
        restart.mockRejectedValue(new Error('locked'));
        await render();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await act(async () => settingSwitch('Wasm Backend').click());
        await vi.waitFor(() => expect(settingSwitch('Wasm Backend').disabled).toBe(false));
        expect(restart).toHaveBeenCalledOnce();
        const warning = records().find(r => r.message === 'Failed to restart the app');
        expect(warning?.keyValues).toEqual({ error: 'locked' });

        // Disabling asks with the other wording
        confirm.mockReturnValue(false);
        act(() => settingSwitch('Wasm Backend').click());
        expect(confirm.mock.calls[1][0]).toContain('Disabling the experimental wasm backend');
    });

    it('reverts the setup confirmation', async () => {
        await render();
        expect(routeState?.confirmedFinishedSetup).toBe(true);
        act(() => button('Restart').click());
        expect(config!.settings?.pauseAfterAppSetup).toBe(true);
        await vi.waitFor(() => expect(routeState?.confirmedFinishedSetup).toBe(false));
        expect(routeState?.appLoadingStatus).toBe(AppLoadingStatus.SETUP_DONE);
    });

    it('does not reset a backend without clearAllStorage', async () => {
        await render();
        const confirm = vi.spyOn(window, 'confirm');
        await act(async () => button('Reset App State').click());
        expect(confirm).not.toHaveBeenCalled();
        expect(records().some(r => r.message === 'clearAllStorage not supported by storage backend')).toBe(true);
    });

    it('resets the app state only once confirmed and reports a failure', async () => {
        const clearAllStorage = vi.fn<() => Promise<void>>(async () => { throw new Error('disk busy'); });
        (backend as SessionTestBackend & { clearAllStorage?: () => Promise<void> }).clearAllStorage = clearAllStorage;
        cache.put('cached');
        await render();

        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
        await act(async () => button('Reset App State').click());
        expect(confirm.mock.calls[0][0]).toContain('This will delete ALL stored data');
        expect(clearAllStorage).not.toHaveBeenCalled();

        confirm.mockReturnValue(true);
        await act(async () => button('Reset App State').click());
        await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('Failed to clear storage: disk busy'));
        expect(clearAllStorage).toHaveBeenCalledOnce();
        // The cache is only cleared after the storage
        expect(cache.clear).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(button('Reset App State')?.disabled).toBe(false));
    });

    it('closes', async () => {
        await render();
        act(() => root.container.querySelector<HTMLButtonElement>('button[aria-label="close-overlay"]')!.click());
        expect(onClose).toHaveBeenCalledOnce();
    });
});
