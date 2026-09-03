import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = vi.hoisted(() => ({ feedProps: null as any }));

vi.mock('./notebook_feed.js', async () => {
    const React = await import('react');
    return {
        NotebookFeed: (props: any) => {
            state.feedProps = props;
            return React.createElement('button', {
                'data-testid': 'open-details',
                onClick: () => props.showDetails('01_alpha.sql'),
            }, 'Open details');
        },
    };
});
vi.mock('../script_details.js', async () => {
    const React = await import('react');
    return {
        ScriptDetails: (props: any) => React.createElement('button', {
            'data-testid': 'close-details',
            onClick: props.hideDetails,
        }, 'Close details'),
        TabKey: { Editor: 0 },
    };
});
vi.mock('../notebook_workbench_sidebar.js', () => ({ NotebookWorkbenchSidebar: () => null }));
vi.mock('../notebook_navigation_drawer.js', () => ({ NotebookNavigationDrawer: () => null }));
vi.mock('../../../../ui/foundations/symbol_icon.js', () => ({ ThreeBarsIcon: () => null }));
vi.mock('../../../../ui/foundations/button.js', async () => {
    const React = await import('react');
    return {
        ButtonVariant: { Default: 0 },
        IconButton: React.forwardRef((props: any, ref: React.ForwardedRef<HTMLButtonElement>) => (
            React.createElement('button', { ...props, ref })
        )),
    };
});

import { NotebookFeedPage } from './notebook_feed_page.js';

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

    it('keeps the exact mounted feed position when closing details', () => {
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts()}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
            />,
        ));
        const initialTarget = state.feedProps.scrollTarget;
        expect(initialTarget).toEqual({ fileName: '01_alpha.sql', version: 1 });

        act(() => (container.querySelector('[data-testid="open-details"]') as HTMLButtonElement).click());
        act(() => (container.querySelector('[data-testid="close-details"]') as HTMLButtonElement).click());

        expect(state.feedProps.scrollTarget).toBe(initialTarget);
    });

    it('still scrolls to cards selected by navigation', () => {
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts()}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
            />,
        ));
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts(1, '02_beta.sql')}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
            />,
        ));

        expect(state.feedProps.scrollTarget).toEqual({ fileName: '02_beta.sql', version: 2 });
    });

    it('scrolls to navigation changes made while details are open', () => {
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts()}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
            />,
        ));
        act(() => (container.querySelector('[data-testid="open-details"]') as HTMLButtonElement).click());
        act(() => root.render(
            <NotebookFeedPage
                notebookScripts={scripts(1, '02_beta.sql')}
                modifyNotebookScripts={vi.fn()}
                connection={null}
                active
            />,
        ));
        act(() => (container.querySelector('[data-testid="close-details"]') as HTMLButtonElement).click());

        expect(state.feedProps.scrollTarget).toEqual({ fileName: '02_beta.sql', version: 2 });
    });
});
