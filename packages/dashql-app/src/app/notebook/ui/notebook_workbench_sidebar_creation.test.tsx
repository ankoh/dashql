import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AttachedDatabaseState } from '../connections/attached_database_state.js';

const state = vi.hoisted(() => ({
    navigate: vi.fn(),
    dispatchDatabase: vi.fn(),
    setupNotebookScripts: vi.fn(),
    write: vi.fn<() => Promise<boolean>>(),
    refreshCatalog: vi.fn(),
    local: null as AttachedDatabaseState | null,
    overlayProps: null as { isOpen: boolean; onClose: () => void; onConnected?: (database: AttachedDatabaseState) => void } | null,
    attachedDatabasesByNotebook: new Map<string, { mainDatabaseId: string; attachedDatabaseIds: string[] }>(),
}));

vi.mock('../../router/router.js', () => ({
    CHANGE_NOTEBOOK: Symbol.for('change-notebook'),
    OPEN_NOTEBOOK: Symbol.for('open-notebook'),
    SELECT_NOTEBOOK: Symbol('SELECT_NOTEBOOK'),
    useRouteContext: () => ({ notebookId: 'current-notebook', notebookSetupStatus: 0 }),
    useRouterNavigate: () => state.navigate,
}));
vi.mock('../connections/connection_params.js', () => ({
    createDefaultHyperWasmAttachedDatabaseState: () => ({ type: 'local' }),
    getConnectionParamsFromStateDetails: () => null,
}));
vi.mock('../connections/attached_database_registry.js', () => ({
    resolveNotebookAttachedDatabases: () => null,
    useAttachedDatabaseRegistry: () => [{ attachedDatabasesByNotebook: new Map() }],
    useNotebookAttachedDatabases: () => null,
    useDynamicAttachedDatabaseDispatch: () => [{
        attachedDatabases: new Map(),
        attachedDatabasesByNotebook: state.attachedDatabasesByNotebook,
        attachedDatabasesBySignature: new Map(),
    }, state.dispatchDatabase],
    useAttachedDatabaseStateAllocator: () => () => state.local,
}));
vi.mock('../connections/ui/connection_settings_overlay.js', () => ({
    ConnectionSettingsOverlay: (props: typeof state.overlayProps) => {
        state.overlayProps = props;
        return props?.isOpen ? <button onClick={() => props.onConnected?.(state.local!)}>Complete setup</button> : null;
    },
}));
vi.mock('../connections/catalog_loader.js', () => ({ useCatalogLoaderQueue: () => state.refreshCatalog }));
vi.mock('../scripts/notebook_scripts_registry.js', () => ({
    useNotebookScripts: () => [null, vi.fn()],
    useNotebookScriptsDeletion: () => vi.fn(),
    useNotebookScriptsRegistry: () => [{ notebookScriptsMap: new Map() }],
}));
vi.mock('../scripts/notebook_scripts_setup.js', () => ({
    useNotebookScriptsSetup: () => state.setupNotebookScripts,
}));
vi.mock('../persistence/storage_provider.js', () => ({
    useStorageReader: () => ({ getNotebookOrder: () => [] }),
    useStorageWriter: () => ({
        write: state.write,
        backend: {},
        cancelPendingWritesForNotebook: vi.fn(),
    }),
}));
vi.mock('../agent/agent_run_provider.js', () => ({ useCancelAgentRun: () => vi.fn() }));
vi.mock('../../../compute/computation_registry.js', () => ({ useComputationRegistry: () => [null, vi.fn()] }));
vi.mock('../../../platform/file/file_downloader_provider.js', () => ({ useFileDownloader: () => ({}) }));
vi.mock('../../ui/bundled_notebooks_overlay.js', () => ({ BundledNotebooksOverlay: () => null }));
vi.mock('../persistence/notebook_import_provider.js', () => ({ useNotebookImport: () => ({}) }));
vi.mock('../persistence/invalid_notebook_registry.js', () => ({ useInvalidNotebookRegistry: () => ({ invalidNotebooks: new Map(), deleteInvalidNotebook: vi.fn() }) }));
vi.mock('../../providers/core_provider.js', () => ({ useDashQLCoreSetup: () => vi.fn() }));
vi.mock('../../../platform/logger/logger_provider.js', () => ({ useLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));
vi.mock('../../../platform/platform_type.js', () => ({ PlatformType: { WEB: 0, MACOS: 1 }, usePlatformType: () => 0 }));
vi.mock('../../router/notebook_setup_status.js', () => ({ NotebookSetupStatus: { NONE: 0, OPENING: 1, CONFIGURING: 2 } }));

import { HYPER_CONNECTOR } from '../connections/connector_info.js';
import { NotebookWorkbenchSidebar } from './notebook_workbench_sidebar.js';

describe('NotebookWorkbenchSidebar notebook creation', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        state.navigate.mockReset();
        state.dispatchDatabase.mockReset();
        state.setupNotebookScripts.mockReset();
        state.write.mockReset().mockResolvedValue(true);
        state.refreshCatalog.mockReset();
        state.overlayProps = null;
        state.attachedDatabasesByNotebook.clear();
        state.local = { databaseId: 'local-database' } as AttachedDatabaseState;
        state.local = {
            databaseId: 'local-database',
            details: { type: HYPER_CONNECTOR, value: { proto: { setupParams: { protocol: 'WASM' } } } },
        } as AttachedDatabaseState;
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
        act(() => root.render(<NotebookWorkbenchSidebar notebookScripts={{
            notebookId: 'current-notebook',
            instance: {},
        } as any} />));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        act(() => root.unmount());
        container.remove();
    });

    function click(label: string): void {
        act(() => {
            (container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
        });
    }

    it('creates a notebook only after the selected main database connects', async () => {
        click('Create notebook');
        expect(state.setupNotebookScripts).not.toHaveBeenCalled();
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Complete setup')!.click();
            await Promise.resolve();
        });
        expect(state.setupNotebookScripts).toHaveBeenCalledWith(
            '00000000-0000-4000-8000-000000000001',
            state.local,
        );
        expect(state.navigate).toHaveBeenCalledWith({
            type: expect.any(Symbol),
            value: '00000000-0000-4000-8000-000000000001',
        });
    });
});
