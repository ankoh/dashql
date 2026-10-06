import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotebookFeedPage, type NotebookFeedPageDependencies } from './notebook_feed_page.js';
import { NotebookViewMode } from '../../scripts/notebook_commands.js';
import { SegmentedControl } from '../../../../ui/foundations/segmented_control.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = {
    feedProps: null as any,
    dashboardsEnabled: false,
    mode: NotebookViewMode.Notebook,
    setMode: vi.fn(),
    dashboardProps: null as any,
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
