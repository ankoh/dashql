import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotebookFeedPage, type NotebookFeedPageDependencies } from './notebook_feed_page.js';
import { NotebookViewMode } from '../../scripts/notebook_commands.js';
import { SegmentedControl } from '../../../../ui/foundations/segmented_control.js';
import { Button } from '../../../../ui/foundations/button.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = {
    feedProps: null as any,
    dashboardsEnabled: false,
    mode: NotebookViewMode.Notebook,
    setMode: vi.fn(),
    dashboardProps: null as any,
    shareProps: null as any,
    exportProps: null as any,
    storageProps: null as any,
};
const dependencies = {
    NotebookFeed: (props: any) => {
        state.feedProps = props;
        return null;
    },
    ScriptDetails: () => null,
    NotebookWorkbenchSidebar: () => null,
    NotebookNavigationDrawer: () => null,
    ThreeBarsIcon: () => null,
    IconButton: React.forwardRef((props: any, ref: React.ForwardedRef<HTMLButtonElement>) => <button {...props} ref={ref} />),
    Button,
    NotebookURLShareOverlay: (props: any) => {
        state.shareProps = props;
        return null;
    },
    NotebookFileSaveOverlay: (props: any) => {
        state.exportProps = props;
        return null;
    },
    NotebookStorageOverlay: (props: any) => {
        state.storageProps = props;
        return props.renderAnchor({ onClick: props.onOpen });
    },
    Dashboard: (props: any) => {
        state.dashboardProps = props;
        return <div data-testid="dashboard" />;
    },
    useNotebookViewMode: () => ({ mode: state.mode, setMode: state.setMode }),
    useAppConfig: () => ({ settings: { enableDashboards: state.dashboardsEnabled } }),
    SegmentedControl,
} as unknown as NotebookFeedPageDependencies;

function scripts() {
    return {
        notebookId: 'notebook',
        notebookMetadata: { originalFileName: 'notebook' },
        scriptFocus: { fileName: '01_alpha.sql' },
        scriptRefs: {
            '01_alpha.sql': { scriptId: 1, fileName: '01_alpha.sql' },
        },
        scripts: {
            1: { scriptKey: 1, fileName: '01_alpha.sql' },
        },
    } as any;
}

describe('NotebookFeedPage', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        state.feedProps = null;
        state.dashboardsEnabled = false;
        state.mode = NotebookViewMode.Notebook;
        state.setMode.mockReset();
        state.dashboardProps = null;
        state.shareProps = null;
        state.exportProps = null;
        state.storageProps = null;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('does not request automatic feed scrolling', () => {
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts()}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        expect(state.feedProps).not.toHaveProperty('scrollTarget');
    });

    it('uses one header for the workbench toggle, view switcher, and notebook actions', () => {
        state.dashboardsEnabled = true;
        const notebookScripts = scripts();
        const connection = { databaseId: 'database' } as any;
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={notebookScripts}
                modifyNotebookScripts={vi.fn()}
                connection={connection}
                active
                dependencies={dependencies}
            />,
        ));

        const header = container.querySelector('header')!;
        expect(container.querySelectorAll('header')).toHaveLength(1);
        expect(header.querySelector('[aria-label="Open notebook workbench"]')).not.toBeNull();
        expect(header.querySelector('[aria-label="Notebook view"]')).not.toBeNull();
        for (const label of ['Share as URL', 'Export .dashql', 'Storage']) {
            const button = header.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
            expect(button).not.toBeNull();
            expect(button?.querySelector('svg')?.parentElement?.nextElementSibling?.textContent).toBe(label);
        }

        act(() => header.querySelector<HTMLButtonElement>('[aria-label="Share as URL"]')!.click());
        expect(state.shareProps).toMatchObject({ notebookId: 'notebook', isOpen: true });
        expect(state.shareProps.anchorRef.current).toBe(header.querySelector('[aria-label="Share as URL"]'));
        expect(header.querySelector('[aria-label="Share as URL"]')?.getAttribute('aria-expanded')).toBe('true');

        act(() => header.querySelector<HTMLButtonElement>('[aria-label="Export .dashql"]')!.click());
        expect(state.exportProps).toMatchObject({ notebookScripts, conn: connection, isOpen: true });
        expect(state.exportProps.anchorRef.current).toBe(header.querySelector('[aria-label="Export .dashql"]'));
        expect(header.querySelector('[aria-label="Export .dashql"]')?.getAttribute('aria-expanded')).toBe('true');

        act(() => header.querySelector<HTMLButtonElement>('[aria-label="Storage"]')!.click());
        expect(state.storageProps).toMatchObject({ notebookId: 'notebook', isOpen: true });
    });

    it('keeps the single action header when dashboards are disabled', () => {
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts()}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        expect(container.querySelectorAll('header')).toHaveLength(1);
        expect(container.querySelector('header [aria-label="Notebook view"]')).toBeNull();
        expect(container.querySelector('header [aria-label="Storage"]')).not.toBeNull();
    });

    it('hides the Dashboard switch by default', () => {
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts()}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        expect(container.querySelector('[aria-label="Notebook view"]')).toBeNull();
        expect(container.querySelector('[data-testid="dashboard"]')).toBeNull();
        expect(state.feedProps.active).toBe(true);
    });

    it('does not render a Dashboard requested while disabled', () => {
        state.mode = NotebookViewMode.Dashboard;
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts()}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        expect(container.querySelector('[data-testid="dashboard"]')).toBeNull();
        expect(state.feedProps.active).toBe(true);
    });

    it('switches between Notebook and Dashboard from the content view bar when enabled', () => {
        state.dashboardsEnabled = true;
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts()}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        const buttons = container.querySelectorAll<HTMLButtonElement>('[aria-label="Notebook view"] button');
        expect(buttons[0]?.getAttribute('aria-current')).toBe('true');
        act(() => buttons[1]?.click());
        expect(state.setMode).toHaveBeenCalledWith(NotebookViewMode.Dashboard);
    });

    it('renders the Dashboard beneath the view bar without activating the feed', () => {
        state.dashboardsEnabled = true;
        state.mode = NotebookViewMode.Dashboard;
        const notebookScripts = scripts();
        const modifyNotebookScripts = vi.fn();
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={notebookScripts}
                modifyNotebookScripts={modifyNotebookScripts}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        expect(container.querySelector('[data-testid="dashboard"]')).not.toBeNull();
        expect(state.dashboardProps).toMatchObject({ notebookScripts, modifyNotebookScripts });
        expect(state.feedProps.active).toBe(false);
        const buttons = container.querySelectorAll<HTMLButtonElement>('[aria-label="Notebook view"] button');
        expect(buttons[1]?.getAttribute('aria-current')).toBe('true');
        act(() => buttons[0]?.click());
        expect(state.setMode).toHaveBeenCalledWith(NotebookViewMode.Notebook);
    });
});
