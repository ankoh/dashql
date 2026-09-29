import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotebookFeedPage, type NotebookFeedPageDependencies } from './notebook_feed_page.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = { feedProps: null as any };
const dependencies = {
    NotebookFeed: (props: any) => {
        state.feedProps = props;
        return <button data-testid="open-details" onClick={() => props.showDetails('01_alpha.sql')}>Open details</button>;
    },
    ScriptDetails: (props: any) => <button data-testid="close-details" onClick={props.hideDetails}>Close details</button>,
    NotebookWorkbenchSidebar: () => null,
    NotebookNavigationDrawer: () => null,
    ThreeBarsIcon: () => null,
    IconButton: React.forwardRef((props: any, ref: React.ForwardedRef<HTMLButtonElement>) => <button {...props} ref={ref} />),
} as unknown as NotebookFeedPageDependencies;

function scripts(interactionCounter = 0, fileName = '01_alpha.sql') {
    return {
        notebookId: 'notebook',
        scriptFocus: { fileName, interactionCounter },
        scriptRefs: {
            '01_alpha.sql': { scriptId: 1, fileName: '01_alpha.sql' },
            '02_beta.sql': { scriptId: 2, fileName: '02_beta.sql' },
        },
        scripts: {
            1: { scriptKey: 1, fileName: '01_alpha.sql' },
            2: { scriptKey: 2, fileName: '02_beta.sql' },
        },
    } as any;
}

describe('NotebookFeedPage scroll restoration', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        state.feedProps = null;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('keeps the exact mounted feed position when closing details', async () => {
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts()}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));
        await vi.waitFor(() => expect(state.feedProps.scrollTarget).toEqual({ fileName: '01_alpha.sql', version: 1 }));
        const initialTarget = state.feedProps.scrollTarget;

        act(() => (container.querySelector('[data-testid="open-details"]') as HTMLButtonElement).click());
        act(() => (container.querySelector('[data-testid="close-details"]') as HTMLButtonElement).click());

        await vi.waitFor(() => expect(state.feedProps.scrollTarget).toBe(initialTarget));
    });

    it('still scrolls to cards selected by navigation', async () => {
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts()}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));
        await vi.waitFor(() => expect(state.feedProps.scrollTarget).toEqual({ fileName: '01_alpha.sql', version: 1 }));
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts(1, '02_beta.sql')}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));

        await vi.waitFor(() => expect(state.feedProps.scrollTarget).toEqual({ fileName: '02_beta.sql', version: 2 }));
    });

    it('scrolls to navigation changes made while details are open', async () => {
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts()}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));
        await vi.waitFor(() => expect(state.feedProps.scrollTarget).toEqual({ fileName: '01_alpha.sql', version: 1 }));
        act(() => (container.querySelector('[data-testid="open-details"]') as HTMLButtonElement).click());
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts(1, '02_beta.sql')}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
                dependencies={dependencies}
            />,
        ));
        act(() => (container.querySelector('[data-testid="close-details"]') as HTMLButtonElement).click());

        await vi.waitFor(() => expect(state.feedProps.scrollTarget).toEqual({ fileName: '02_beta.sql', version: 2 }));
    });
});
