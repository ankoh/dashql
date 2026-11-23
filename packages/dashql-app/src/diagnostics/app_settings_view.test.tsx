import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSettings } from './app_settings_view.js';
import { AppConfigProvider, useAppConfig, type AppConfig } from '../config/app_config.js';
import { FlavorProvider, useAppFlavor } from '../config/flavor_provider.js';
import { DASHQL_FLAVOR, FLAVORS, type AppFlavor } from '../config/flavors.js';
import { LoggerProvider, useLogger } from '../host/logger_provider.js';
import { LogLevel } from '@akohn/dashql/platform/logger/log_buffer';
import type { Logger } from '@akohn/dashql/platform/logger/logger';
import { APP_RESTART_CTX } from '../host/app_hand_over.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { applyFlavorToDocument } from '../config/flavor_resolution.js';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { AppSetupConfirmationProvider } from '../app/loading/app_setup.js';

describe('AppSettings', () => {
    let root: ReturnType<typeof createTestRoot>;
    let backend: WorkbookTestBackend;
    let restart: ReturnType<typeof vi.fn<() => Promise<void>>>;
    let onClose: ReturnType<typeof vi.fn<() => void>>;
    let config: AppConfig | null;
    let flavor: AppFlavor;
    let logger: Logger;
    let confirmFinishedSetup: ReturnType<typeof vi.fn<(confirmed: boolean) => void>>;

    function Capture() {
        config = useAppConfig();
        flavor = useAppFlavor();
        logger = useLogger();
        return null;
    }

    async function render(requested: AppFlavor | null = null) {
        await root.render(
            <LoggerProvider>
                <FlavorProvider requested={requested}>
                    <AppConfigProvider>
                        <MemoryRouter initialEntries={['/']}>
                            <StorageProvider backend={backend}>
                                <APP_RESTART_CTX.Provider value={restart}>
                                    <AppSetupConfirmationProvider value={confirmFinishedSetup}>
                                        <Capture />
                                        <AppSettings onClose={onClose} />
                                    </AppSetupConfirmationProvider>
                                </APP_RESTART_CTX.Provider>
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
    const segment = (labelId: string, label: string) => segments(labelId).find(b => b.textContent === label)!;
    const records = () => [...Array(logger.buffer.length).keys()].map(i => logger.buffer.at(i)!);
    const button = (text: string) => [...root.container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;

    beforeEach(() => {
        root = createTestRoot();
        backend = new WorkbookTestBackend();
        restart = vi.fn<() => Promise<void>>(async () => {});
        onClose = vi.fn<() => void>();
        config = null;
        confirmFinishedSetup = vi.fn<(confirmed: boolean) => void>();
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
        const initial = { ...config!.settings };

        const toggles: [string, keyof NonNullable<AppConfig['settings']>][] = [
            ['Narrow Screen Layout', 'narrowScreenLayout'],
            ['Mac Window Layout', 'macWindowLayout'],
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
        // The other settings stay
        expect(config!.settings).toMatchObject(initial);
    });

    it('switches the keyword case and the minimum log level', async () => {
        await render();
        expect(selectedSegment('app-setting-keyword-case')).toBe('Lowercase');
        act(() => segment('app-setting-keyword-case', 'Uppercase').click());
        expect(config!.settings?.keywordCase).toBe('upper');
        expect(selectedSegment('app-setting-keyword-case')).toBe('Uppercase');
        act(() => segment('app-setting-keyword-case', 'Lowercase').click());
        expect(config!.settings?.keywordCase).toBe('lower');

        expect(selectedSegment('app-setting-min-log-level')).toBe('Info');
        expect(logger.buffer.getMinLogLevel()).toBe(LogLevel.Info);
        act(() => segment('app-setting-min-log-level', 'Trace').click());
        expect(config!.settings?.minLogLevel).toBe(LogLevel.Trace);
        expect(selectedSegment('app-setting-min-log-level')).toBe('Trace');
        expect(logger.buffer.getMinLogLevel()).toBe(LogLevel.Trace);
        act(() => segment('app-setting-min-log-level', 'Error').click());
        expect(logger.buffer.getMinLogLevel()).toBe(LogLevel.Error);
    });

    it('switches the flavor', async () => {
        await render();
        const flavors = [...FLAVORS.values()];
        expect(segments('app-setting-flavor').map(b => b.textContent)).toEqual(flavors.map(f => f.displayName));
        expect(selectedSegment('app-setting-flavor')).toBe(DASHQL_FLAVOR.displayName);

        const other = flavors.findIndex(f => f.id !== DASHQL_FLAVOR.id);
        act(() => segments('app-setting-flavor')[other].click());
        expect(config!.settings?.flavor).toBe(flavors[other].id);
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
        act(() => button('Restart').click());
        expect(config!.settings?.pauseAfterAppSetup).toBe(true);
        expect(confirmFinishedSetup).toHaveBeenCalledExactlyOnceWith(false);
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
        (backend as WorkbookTestBackend & { clearAllStorage?: () => Promise<void> }).clearAllStorage = clearAllStorage;
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
        await vi.waitFor(() => expect(button('Reset App State')?.disabled).toBe(false));
    });

    it('closes', async () => {
        await render();
        act(() => root.container.querySelector<HTMLButtonElement>('button[aria-label="close-overlay"]')!.click());
        expect(onClose).toHaveBeenCalledOnce();
    });
});
