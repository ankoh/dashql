import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSettingsSync, useAppSettingsReady } from './app_settings_sync.js';
import { AppConfigProvider, useAppConfig, useAppReconfigure, type AppConfig } from './app_config.js';
import { FlavorProvider, useAppFlavor } from './flavor_provider.js';
import { DASHQL_FLAVOR, SIDB_FLAVOR, type AppFlavor } from './flavors.js';
import { LoggerProvider, useLogger } from '../platform/logger/logger_provider.js';
import type { Logger } from '../platform/logger/logger.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { SessionTestBackend } from '../storage/session_test_backend.js';
import { applyFlavorToDocument } from './flavor_resolution.js';
import { createTestRoot } from '../tests/react_root.js';

describe('AppSettingsSync', () => {
    let root: ReturnType<typeof createTestRoot>;
    let backend: SessionTestBackend;
    let config: AppConfig | null;
    let ready: boolean;
    let flavor: AppFlavor;
    let logger: Logger;
    let reconfigure: ReturnType<typeof useAppReconfigure>;

    function Capture() {
        config = useAppConfig();
        ready = useAppSettingsReady();
        flavor = useAppFlavor();
        logger = useLogger();
        reconfigure = useAppReconfigure();
        return null;
    }

    async function render(requested: AppFlavor | null = null) {
        await root.render(
            <LoggerProvider>
                <FlavorProvider requested={requested}>
                    <AppConfigProvider>
                        <StorageProvider backend={backend}>
                            <AppSettingsSync>
                                <Capture />
                            </AppSettingsSync>
                        </StorageProvider>
                    </AppConfigProvider>
                </FlavorProvider>
            </LoggerProvider>,
        );
    }

    const records = () => [...Array(logger.buffer.length).keys()].map(i => logger.buffer.at(i)!);

    beforeEach(() => {
        root = createTestRoot();
        backend = new SessionTestBackend();
        config = null;
        ready = false;
    });

    afterEach(() => {
        root.unmount();
        // The flavors brand the document, the other tests expect the default flavor
        applyFlavorToDocument(DASHQL_FLAVOR);
        vi.restoreAllMocks();
    });

    it('hydrates the stored settings and drops the retired ones', async () => {
        backend.appSettings = {
            keywordCase: 'upper',
            flavor: SIDB_FLAVOR.id,
            lastOpenedSessionId: 'retired',
            aiProvider: { apiKey: 'secret' },
            experimental_dashboards: true,
            experimental_dataflow: false,
        } as NonNullable<AppConfig['settings']>;
        await render();
        expect(ready).toBe(false);
        await vi.waitFor(() => expect(ready).toBe(true));
        expect(config!.settings?.keywordCase).toBe('upper');
        // The settings of config.json stay
        expect(config!.settings?.enableTableColumnPlots).toBe(true);
        expect(config!.settings).not.toHaveProperty('lastOpenedSessionId');
        expect(config!.settings).not.toHaveProperty('aiProvider');
        expect(config!.settings).not.toHaveProperty('experimental_dashboards');
        expect(config!.settings).not.toHaveProperty('experimental_dataflow');
        expect(flavor.id).toBe(SIDB_FLAVOR.id);
        expect(records().some(r => r.message === 'Hydrated app settings from manifest')).toBe(true);
    });

    it('keeps the flavor that the url requests', async () => {
        backend.appSettings = { flavor: SIDB_FLAVOR.id };
        await render(DASHQL_FLAVOR);
        await vi.waitFor(() => expect(ready).toBe(true));
        expect(config!.settings?.flavor).toBe(SIDB_FLAVOR.id);
        expect(flavor.id).toBe(DASHQL_FLAVOR.id);
    });

    it('persists the changed settings once hydrated', async () => {
        await render();
        await vi.waitFor(() => expect(ready).toBe(true));
        // Without stored settings the config stays as downloaded
        expect(records().some(r => r.message === 'Hydrated app settings from manifest')).toBe(false);

        act(() => reconfigure(c => c == null ? null : { ...c, settings: { ...c.settings, scriptDebugMode: true, flavor: SIDB_FLAVOR.id } }));
        // The settings select the flavor right away
        expect(flavor.id).toBe(SIDB_FLAVOR.id);
        // The settings are saved after the changes pause
        await vi.waitFor(() => expect(backend.appSettings?.scriptDebugMode).toBe(true));
        expect(backend.appSettings?.flavor).toBe(SIDB_FLAVOR.id);
    });

    it('logs failures to load and save the settings', async () => {
        vi.spyOn(backend, 'loadAppSettings').mockRejectedValue(new Error('manifest unreadable'));
        const save = vi.spyOn(backend, 'saveAppSettings').mockRejectedValue(new Error('disk full'));
        await render();
        // A failed load still lets the app start
        await vi.waitFor(() => expect(ready).toBe(true));
        expect(records().find(r => r.message === 'Failed to load app settings from manifest')?.keyValues)
            .toEqual({ error: 'Error: manifest unreadable' });

        act(() => reconfigure(c => c == null ? null : { ...c, settings: { ...c.settings, tableDebugMode: true } }));
        await vi.waitFor(() => expect(records().find(r => r.message === 'Failed to persist app settings')?.keyValues)
            .toEqual({ error: 'Error: disk full' }));
        expect(save.mock.calls[save.mock.calls.length - 1][0].tableDebugMode).toBe(true);
    });
});
