import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.stubGlobal('ResizeObserver', ResizeObserverMock);


import {
    DELETE_NOTEBOOK_ENTRY,
    PROMOTE_UNCOMMITTED_SCRIPT,
    SELECT_ENTRY,
    type NotebookState,
} from '../../notebook/notebook_state.js';
import { NotebookScriptFeed } from './notebook_script_feed.js';

function makeScriptData(scriptKey: number, text: string) {
    return {
        scriptKey,
        script: { toString: () => text } as any,
        scriptAnalysis: {
            buffers: {
                scanned: null,
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
    };
}

function createNotebookState(): NotebookState {
    return {
        notebookId: 42,
        instance: {} as any,
        notebookMetadata: {} as any,
        connectorInfo: {} as any,
        connectionId: 7,
        connectionCatalog: {} as any,
        scriptRegistry: {} as any,
        scripts: {
            101: makeScriptData(101, 'select 1'),
            102: makeScriptData(102, 'select 2'),
            999: makeScriptData(999, ''),
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
            103: makeScriptData(103, 'select 3'),
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
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
    });

    function renderFeed(props: React.ComponentProps<typeof NotebookScriptFeed>) {
        act(() => {
            root.render(<NotebookScriptFeed {...props} />);
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

        const sendButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Send');
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

        const sendButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Send');
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
