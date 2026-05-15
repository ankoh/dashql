import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import {
    fakeButtonModule,
    fakeReactWindowModule,
    fakeScrollbarModule,
    fakeScriptEditorModule,
    fakeScriptPreviewModule,
    fakeSizeObserverModule,
    fakeStatusIndicatorModule,
    fakeSymbolIconModule,
    ResizeObserverMock,
} from '../../test/view_mocks.js';

const mockState = vi.hoisted(() => ({
    scrollToRowMock: vi.fn(),
    composeEditorFocused: true,
    keyHandlers: [] as Array<{
        key: string;
        ctrlKey?: boolean;
        capture?: boolean;
        callback: (event: KeyboardEvent) => void;
    }>,
    queryStates: new Map<number, { traceId: number; status: number }>(),
}));
vi.mock('react-window', async () => fakeReactWindowModule(await import('react'), mockState.scrollToRowMock));
vi.mock('./script_editor.js', async () => fakeScriptEditorModule(await import('react'), mockState));
vi.mock('./notebook_script_preview.js', async () => fakeScriptPreviewModule(await import('react')));
vi.mock('../foundations/button.js', async () => fakeButtonModule(await import('react')));
vi.mock('../foundations/status_indicator.js', async () => fakeStatusIndicatorModule(await import('react')));
vi.mock('../foundations/symbol_icon.js', async () => fakeSymbolIconModule(await import('react')));
vi.mock('../foundations/size_observer.js', () => fakeSizeObserverModule());
vi.mock('../../utils/scrollbar.js', () => fakeScrollbarModule());
vi.mock('../../utils/key_events.js', () => ({
    useKeyEvents: (handlers: typeof mockState.keyHandlers) => {
        mockState.keyHandlers = handlers;
    },
}));
vi.mock('../../notebook/notebook_commands.js', () => ({
    NotebookCommandType: { ExecuteEditorQuery: 1 },
    useNotebookCommandDispatch: () => () => { },
}));
vi.mock('../../connection/query_executor.js', () => ({
    useQueryState: (_sessionId: string | null, queryId: number | null) => {
        if (queryId == null) return null;
        return mockState.queryStates.get(queryId) ?? null;
    },
}));
vi.mock('../internals/trace_log_viewer.js', async () => {
    const React = await import('react');
    return {
        TraceLogViewer: (props: { traceId?: number; height?: number }) =>
            React.createElement('div', { 'data-testid': 'trace-log-viewer', 'data-trace-id': props.traceId }),
    };
});
vi.mock('./feed_entry_footer.js', async () => {
    const React = await import('react');
    return {
        FeedEntryFooter: (props: { traceId?: number }) =>
            React.createElement('div', { 'data-testid': 'trace-log-viewer', 'data-trace-id': props.traceId }),
    };
});
vi.stubGlobal('ResizeObserver', ResizeObserverMock);


import {
    DELETE_NOTEBOOK_ENTRY,
    PROMOTE_UNCOMMITTED_SCRIPT,
    SELECT_ENTRY,
    type NotebookState,
} from '../../notebook/notebook_state.js';
import { ConnectionHealth, type ConnectionState } from '../../connection/connection_state.js';
import { NotebookScriptFeed } from './notebook_script_feed.js';

function createOnlineConnection(): ConnectionState {
    return { connectionHealth: ConnectionHealth.ONLINE } as unknown as ConnectionState;
}

function makeScriptData(scriptKey: number, text: string, pageIndex: number = -1, fileName: string = '', folderName: string = '') {
    return {
        scriptKey,
        script: { toString: () => text } as any,
        scriptAnalysis: {
            buffers: {
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
            outdated: false,
        },
        annotations: {} as any,
        statistics: [] as any,
        cursor: null,
        completion: null,
        latestQueryId: null,
        pageIndex,
        fileName,
        folderName,
    };
}

function createNotebookState(): NotebookState {
    return {
        sessionId: crypto.randomUUID(),
        instance: {} as any,
        notebookMetadata: {} as any,
        connectorInfo: {} as any,
        connectionCatalog: {} as any,
        scriptRegistry: {} as any,
        scripts: {
            101: makeScriptData(101, 'select 1', 0, '01-script.sql', 'Main'),
            102: makeScriptData(102, 'select 2', 0, '02-script.sql', 'Main'),
            999: makeScriptData(999, ''), // Draft script with defaults
        },
        uncommittedScriptId: 999,
        notebookPages: [
            {
                scripts: [
                    { scriptId: 101, title: 'Query 1' },
                    { scriptId: 102, title: 'Query 2' },
                ],
            } as any,
        ],
        notebookUserFocus: {
            pageIndex: 0,
            entryInPage: 0,
        },
        semanticUserFocus: null,
    };
}

function appendCommittedEntry(notebook: NotebookState): NotebookState {
    return {
        ...notebook,
        scripts: {
            ...notebook.scripts,
            103: makeScriptData(103, 'select 3', 0, '03-script.sql', 'Main'),
        },
        notebookPages: [
            {
                ...notebook.notebookPages[0],
                scripts: [
                    ...notebook.notebookPages[0].scripts,
                    { scriptId: 103, title: 'Query 3' },
                ],
            } as any,
        ],
    };
}

describe('NotebookScriptFeed', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        mockState.scrollToRowMock.mockReset();
        mockState.composeEditorFocused = true;
        mockState.keyHandlers = [];
        mockState.queryStates.clear();
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
    });

    function renderFeed(props: Partial<React.ComponentProps<typeof NotebookScriptFeed>> & {
        notebook: NotebookState;
        modifyNotebook: React.ComponentProps<typeof NotebookScriptFeed>['modifyNotebook'];
        showDetails: React.ComponentProps<typeof NotebookScriptFeed>['showDetails'];
    }) {
        const fullProps: React.ComponentProps<typeof NotebookScriptFeed> = {
            scrollTarget: null,
            conn: createOnlineConnection(),
            openConnectionOverlay: () => { },
            ...props,
        };
        act(() => {
            root.render(<NotebookScriptFeed {...fullProps} />);
        });
    }

    it('dispatches SELECT_ENTRY and shows details when a preview is activated', () => {
        const modifyNotebook = vi.fn();
        const showDetails = vi.fn();
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook,
            showDetails,
            scrollTarget: null,
        });

        const previews = container.querySelectorAll('[data-testid="script-preview"]');
        expect(previews.length).toBe(2);

        act(() => {
            previews[1].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
        });

        expect(modifyNotebook).toHaveBeenCalledWith({
            type: SELECT_ENTRY,
            value: 1,
        });
        expect(showDetails).toHaveBeenCalledTimes(1);
    });

    it('dispatches DELETE_NOTEBOOK_ENTRY when delete is clicked', () => {
        const modifyNotebook = vi.fn();
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const deleteButtons = container.querySelectorAll('[aria-label="delete"]');
        expect(deleteButtons.length).toBe(2);

        act(() => {
            (deleteButtons[0] as HTMLButtonElement).click();
        });

        expect(modifyNotebook).toHaveBeenCalledWith({
            type: DELETE_NOTEBOOK_ENTRY,
            value: 0,
        });
    });

    it('dispatches PROMOTE_UNCOMMITTED_SCRIPT when Send is clicked', () => {
        const modifyNotebook = vi.fn();
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const sendButton = Array.from(container.querySelectorAll('button')).find(button => {
            const label = button.getAttribute('aria-label');
            return label === 'Save' || label === 'Save & Execute';
        });
        expect(sendButton).toBeDefined();

        act(() => {
            (sendButton as HTMLButtonElement).click();
        });

        expect(modifyNotebook).toHaveBeenCalledWith({
            type: PROMOTE_UNCOMMITTED_SCRIPT,
            value: null,
        });
    });

    it('dispatches PROMOTE_UNCOMMITTED_SCRIPT on Ctrl+Enter when the compose editor is focused', () => {
        const modifyNotebook = vi.fn();
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const handler = mockState.keyHandlers.find(candidate => candidate.key === 'Enter' && candidate.ctrlKey === true && candidate.capture === true);
        expect(handler).toBeDefined();

        const preventDefault = vi.fn();
        act(() => {
            handler!.callback({ preventDefault } as unknown as KeyboardEvent);
        });

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(modifyNotebook).toHaveBeenCalledWith({
            type: PROMOTE_UNCOMMITTED_SCRIPT,
            value: null,
        });
    });

    it('does not send on Ctrl+Enter when the compose editor is not focused', () => {
        mockState.composeEditorFocused = false;
        const modifyNotebook = vi.fn();
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const handler = mockState.keyHandlers.find(candidate => candidate.key === 'Enter' && candidate.ctrlKey === true && candidate.capture === true);
        expect(handler).toBeDefined();

        const preventDefault = vi.fn();
        act(() => {
            handler!.callback({ preventDefault } as unknown as KeyboardEvent);
        });

        expect(preventDefault).not.toHaveBeenCalled();
        expect(modifyNotebook).not.toHaveBeenCalledWith({
            type: PROMOTE_UNCOMMITTED_SCRIPT,
            value: null,
        });
    });

    it('scrolls to the requested row when scrollTarget changes', () => {
        const notebook = createNotebookState();
        const modifyNotebook = vi.fn();
        const showDetails = vi.fn();

        renderFeed({
            notebook,
            modifyNotebook,
            showDetails,
            scrollTarget: null,
        });

        mockState.scrollToRowMock.mockClear();

        renderFeed({
            notebook,
            modifyNotebook,
            showDetails,
            scrollTarget: { entryIndex: 1, version: 1 },
        });

        expect(mockState.scrollToRowMock).toHaveBeenCalledWith({
            index: 2,
            align: 'start',
        });
    });

    it('does not show execution footer when latestQueryId is null', () => {
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        const viewers = container.querySelectorAll('[data-testid="trace-log-viewer"]');
        expect(viewers.length).toBe(0);
    });

    it('shows execution footer when a query is running', () => {
        mockState.queryStates.set(42, { traceId: 100, status: 4 /* RUNNING */ });
        const notebook = createNotebookState();
        notebook.scripts[101] = { ...notebook.scripts[101], latestQueryId: 42 };
        renderFeed({
            notebook,
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        const viewers = container.querySelectorAll('[data-testid="trace-log-viewer"]');
        expect(viewers.length).toBe(1);
        expect(viewers[0].getAttribute('data-trace-id')).toBe('100');
    });

    it('keeps execution footer after query succeeds', () => {
        mockState.queryStates.set(42, { traceId: 100, status: 9 /* SUCCEEDED */ });
        const notebook = createNotebookState();
        notebook.scripts[101] = { ...notebook.scripts[101], latestQueryId: 42 };
        renderFeed({
            notebook,
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        const viewers = container.querySelectorAll('[data-testid="trace-log-viewer"]');
        expect(viewers.length).toBe(1);
    });

    it('scrolls to the bottom after send once the promoted entry appears', () => {
        let notebook = createNotebookState();
        const modifyNotebook = vi.fn();
        const showDetails = vi.fn();

        renderFeed({
            notebook,
            modifyNotebook,
            showDetails,
            scrollTarget: null,
        });

        const sendButton = Array.from(container.querySelectorAll('button')).find(button => {
            const label = button.getAttribute('aria-label');
            return label === 'Save' || label === 'Save & Execute';
        });
        expect(sendButton).toBeDefined();

        act(() => {
            (sendButton as HTMLButtonElement).click();
        });

        mockState.scrollToRowMock.mockClear();
        notebook = appendCommittedEntry(notebook);

        renderFeed({
            notebook,
            modifyNotebook,
            showDetails,
            scrollTarget: null,
        });

        expect(mockState.scrollToRowMock).toHaveBeenCalledWith({
            index: 4,
            align: 'end',
        });
    });
});
