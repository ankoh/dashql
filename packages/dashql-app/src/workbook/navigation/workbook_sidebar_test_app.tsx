import * as React from 'react';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';

import type { Runtime } from '@akohn/dashql/runtime';
import type { StorageBackend } from '@akohn/dashql/platform/storage/storage_backend';
import { useRuntime, useWorkbook } from '@akohn/dashql-react/hooks';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { LoggerProvider } from '../../host/logger_provider.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { TestRuntime } from '../../tests/test_runtime.js';
import { WorkbookViewModeProvider } from '../workbook_view_mode.js';
import { WorkbookImportProvider } from '../persistence/workbook_import_provider.js';
import { WorkbookWorkbenchSidebar } from './workbook_workbench_sidebar.js';

type SidebarProps = Omit<React.ComponentProps<typeof WorkbookWorkbenchSidebar>, 'workbookScripts'>;

/// The sidebar of a test in the providers of the app: the runtime of the app on a storage of the test, a router at the
/// root, the view mode and the imports of workbooks. The test seeds the runtime before the sidebar shows.
export class SidebarTestApp {
    /// The root of the test
    readonly root = createTestRoot();
    /// The runtime, set by the first render
    runtime!: Runtime;
    /// The location of the router, set by every render
    location!: Location;

    constructor(private readonly backend: StorageBackend) { }

    /// Show the sidebar on the workbook of the page, or only the providers without a workbook
    render(workbookId: string | null, props: SidebarProps = {}): void {
        this.root.render(
            <LoggerProvider>
                <MemoryRouter>
                    <StorageProvider backend={this.backend}>
                        <TestRuntime>
                            <WorkbookViewModeProvider>
                                <WorkbookImportProvider>
                                    <Capture app={this} />
                                    {workbookId != null && <Sidebar workbookId={workbookId} {...props} />}
                                </WorkbookImportProvider>
                            </WorkbookViewModeProvider>
                        </TestRuntime>
                    </StorageProvider>
                </MemoryRouter>
            </LoggerProvider>,
        );
    }

    unmount(): void {
        this.root.unmount();
    }
}

/// Hold the runtime and the location of a render
function Capture(props: { app: SidebarTestApp }) {
    props.app.runtime = useRuntime();
    props.app.location = useLocation();
    return null;
}

/// The sidebar on the view of the workbook that the page shows
function Sidebar(props: SidebarProps & { workbookId: string }) {
    const { workbookId, ...rest } = props;
    const workbook = useWorkbook(workbookId);
    return workbook == null ? null : <WorkbookWorkbenchSidebar workbookScripts={workbook} {...rest} />;
}
