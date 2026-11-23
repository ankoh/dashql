import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { AppConfigProvider, useAppConfig, type AppConfig } from '../../config/app_config.js';
import { FlavorProvider } from '../../config/flavor_provider.js';
import { LoggerProvider } from '../../host/logger_provider.js';
import { type RouteContext, useRouteContext, workbookPath } from '../../app/router.js';
import { useWorkbenchHidden } from './workbench_hidden.js';

describe('useWorkbenchHidden', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    afterEach(() => {
        root?.unmount();
        root = null;
    });

    const current = {
        config: null as AppConfig | null,
        route: null as RouteContext | null,
        hidden: false,
        setHidden: null as ((hidden: boolean) => void) | null,
    };

    /// Render the hook for the workbook s0, the route says which workbook was imported
    async function render(importedWorkbookId: string | null) {
        function Probe() {
            current.config = useAppConfig();
            current.route = useRouteContext();
            [current.hidden, current.setHidden] = useWorkbenchHidden('s0');
            return null;
        }
        const state: RouteContext = { workbookId: 's0', openingWorkbook: false, importedWorkbookId };
        root = createTestRoot();
        await root.render(
            <LoggerProvider>
                <FlavorProvider requested={null}>
                    <AppConfigProvider>
                        <MemoryRouter initialEntries={[{ pathname: workbookPath('s0'), search: '?view=dashboard', state }]}>
                            <Probe />
                        </MemoryRouter>
                    </AppConfigProvider>
                </FlavorProvider>
            </LoggerProvider>,
        );
        // The config is downloaded from config.json
        await vi.waitFor(() => expect(current.config).not.toBeNull());
    }

    it('shows the workbench of a workbook that was not imported', async () => {
        await render(null);
        expect(current.hidden).toBe(false);
    });

    it('hides the workbench of an imported workbook', async () => {
        await render('s0');
        expect(current.hidden).toBe(true);
        expect(current.config?.settings?.workbenchHidden ?? false).toBe(false);
    });

    it('shows the workbench when another workbook was imported', async () => {
        await render('s1');
        expect(current.hidden).toBe(false);
    });

    it('settles the import once the workbench is shown, without saving the setting', async () => {
        await render('s0');
        act(() => current.setHidden!(false));
        await vi.waitFor(() => expect(current.route?.importedWorkbookId).toBeNull());
        expect(current.hidden).toBe(false);
        expect(current.config?.settings?.workbenchHidden ?? false).toBe(false);
    });

    it('saves the setting of a workbook that was not imported', async () => {
        await render(null);
        act(() => current.setHidden!(true));
        await vi.waitFor(() => expect(current.hidden).toBe(true));
        expect(current.config?.settings?.workbenchHidden).toBe(true);
    });
});
