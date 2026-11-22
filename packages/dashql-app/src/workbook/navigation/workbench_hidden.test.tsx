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
    async function render(importedWorkbookId: string | null, opensInView: boolean) {
        function Probe() {
            current.config = useAppConfig();
            current.route = useRouteContext();
            [current.hidden, current.setHidden] = useWorkbenchHidden('s0', opensInView);
            return null;
        }
        const state: RouteContext = { setupDone: true, confirmedFinishedSetup: true, workbookId: 's0', openingWorkbook: false, importedWorkbookId };
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
        await render(null, true);
        expect(current.hidden).toBe(false);
    });

    it('hides the workbench of an imported workbook that opens in a view', async () => {
        await render('s0', true);
        expect(current.hidden).toBe(true);
        expect(current.config?.settings?.workbenchHidden ?? false).toBe(false);
    });

    it.each<[string, string, boolean]>([
        ['opens in the feed', 's0', false],
        ['is another workbook', 's1', true],
    ])('shows the workbench when the imported workbook %s', async (_name, importedWorkbookId, opensInView) => {
        await render(importedWorkbookId, opensInView);
        expect(current.hidden).toBe(false);
    });

    it('settles the import once the workbench is shown, without saving the setting', async () => {
        await render('s0', true);
        act(() => current.setHidden!(false));
        await vi.waitFor(() => expect(current.route?.importedWorkbookId).toBeNull());
        expect(current.hidden).toBe(false);
        expect(current.config?.settings?.workbenchHidden ?? false).toBe(false);
    });

    it('saves the setting of a workbook that was not imported', async () => {
        await render(null, true);
        act(() => current.setHidden!(true));
        await vi.waitFor(() => expect(current.hidden).toBe(true));
        expect(current.config?.settings?.workbenchHidden).toBe(true);
    });
});
