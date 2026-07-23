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
    agentRuns: new Map<number, { traceId: number; phase?: number; log?: Array<{ message: string }> }>(),
    // Drives the mocked size observer. Wide enough by default that the overview toggle is offered
    // (the feed only shows it at >= 1000px of board width); a test can narrow it to hide the toggle.
    observedWidth: 1200,
}));
vi.mock('react-window', async () => fakeReactWindowModule(await import('react'), mockState.scrollToRowMock));
vi.mock('./script_editor.js', async () => fakeScriptEditorModule(await import('react'), mockState));
vi.mock('./notebook_script_preview.js', async () => fakeScriptPreviewModule(await import('react')));
vi.mock('../foundations/button.js', async () => fakeButtonModule(await import('react')));
vi.mock('../foundations/status_indicator.js', async () => fakeStatusIndicatorModule(await import('react')));
vi.mock('../foundations/symbol_icon.js', async () => fakeSymbolIconModule(await import('react')));
vi.mock('../foundations/size_observer.js', () => ({
    observeSize: () => ({ width: mockState.observedWidth, height: 480 }),
}));
vi.mock('../../utils/scrollbar.js', () => fakeScrollbarModule());
vi.mock('../../utils/key_events.js', () => ({
    useKeyEvents: (handlers: typeof mockState.keyHandlers) => {
        mockState.keyHandlers = handlers;
    },
}));
vi.mock('../../notebook/notebook_commands.js', async () => {
    const React = await import('react');
    return {
        NotebookCommandType: { ExecuteEditorQuery: 1 },
        useNotebookCommandDispatch: () => () => { },
        // The feed consumes the compose input mode from the command context; back it with
        // local state so the SQL/AI toggle works in isolation.
        useComposeInputMode: () => {
            const [mode, setMode] = React.useState(0);
            return { mode, setMode };
        },
    };
});
vi.mock('../../connection/query_executor.js', () => ({
    useQueryState: (_sessionId: string | null, queryId: number | null) => {
        if (queryId == null) return null;
        return mockState.queryStates.get(queryId) ?? null;
    },
    useQueryExecutor: () => vi.fn(),
}));
vi.mock('../../agent/agent_run_provider.js', () => ({
    // Resolve an agent run by its id from the backing map, mirroring useQueryState.
    useAgentRunState: (runId: number | null) => {
        if (runId == null) return null;
        return mockState.agentRuns.get(runId) ?? null;
    },
    useLatestAgentRunState: () => null,
    useStartAgentRun: () => vi.fn(),
    useCancelAgentRun: () => vi.fn(),
}));
vi.mock('../internals/trace_log_viewer.js', async () => {
    const React = await import('react');
    return {
        TraceLogViewer: (props: { traceId?: number; height?: number; maxRows?: number }) =>
            React.createElement('div', { 'data-testid': 'trace-log-viewer', 'data-trace-id': props.traceId }),
    };
});
vi.mock('./notebook_page_overview.js', async () => {
    const React = await import('react');
    return {
        NotebookPageOverview: () => React.createElement('div', { 'data-testid': 'page-overview' }),
    };
});
vi.mock('./feed_entry_footer.js', async () => {
    const React = await import('react');
    return {
        FeedEntryFooter: (props: { queryState?: { traceId?: number } | null; agentTraceId?: number | null }) =>
            React.createElement('div', {
                'data-testid': 'trace-log-viewer',
                'data-trace-id': props.queryState?.traceId ?? props.agentTraceId ?? undefined,
            }),
    };
});
vi.stubGlobal('ResizeObserver', ResizeObserverMock);


import {
    ACCEPT_PENDING_DIFF,
    DELETE_NOTEBOOK_ENTRY,
    PROMOTE_UNCOMMITTED_SCRIPT,
    REJECT_PENDING_DIFF,
    SELECT_ENTRY,
    type NotebookState,
} from '../../notebook/notebook_state.js';
import { ConnectionHealth, type ConnectionState } from '../../connection/connection_state.js';
import { NotebookScriptFeed } from './notebook_script_feed.js';

function createOnlineConnection(): ConnectionState {
    return { connectionHealth: ConnectionHealth.ONLINE } as unknown as ConnectionState;
}

function makeScriptData(scriptKey: number, text: string, fileName: string = '', folderName: string = '') {
    return {
        scriptKey,
        // getExecutableQueryText falls back to re-analyzing on demand when no
        // analyzed buffer is cached, so stub the analyze surface it touches.
        script: {
            toString: () => text,
            analyze: () => { },
            getParsed: () => null,
            getAnalyzed: () => null,
        } as any,
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
        pendingDiff: null,
        latestQueryId: null,
        latestAgentRunId: null,
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
            101: makeScriptData(101, 'select 1', '01-script.sql', 'Main'),
            102: makeScriptData(102, 'select 2', '02-script.sql', 'Main'),
            999: makeScriptData(999, ''), // Draft script with defaults
        },
        uncommittedScriptId: 999,
        notebookPages: {
            'Main': {
                folderName: 'Main',
                scripts: {
                    '01-script.sql': { scriptId: 101, fileName: '01-script.sql' },
                    '02-script.sql': { scriptId: 102, fileName: '02-script.sql' },
                },
            },
        },
        notebookUserFocus: {
            folderName: 'Main',
            fileName: '01-script.sql',
            interactionCounter: 0,
        },
        semanticUserFocus: null,
    };
}

function appendCommittedEntry(notebook: NotebookState): NotebookState {
    const main = notebook.notebookPages['Main'];
    return {
        ...notebook,
        scripts: {
            ...notebook.scripts,
            103: makeScriptData(103, 'select 3', '03-script.sql', 'Main'),
        },
        notebookPages: {
            ...notebook.notebookPages,
            'Main': {
                ...main,
                scripts: {
                    ...main.scripts,
                    '03-script.sql': { scriptId: 103, fileName: '03-script.sql' },
                },
            },
        },
    };
}

/// Stage a pending agent diff on an entry's script data (mirrors what SET_SCRIPT_TEXT with
/// withDiff: true produces). Only the presence of `pendingDiff` matters to the feed card.
function withPendingDiff(notebook: NotebookState, scriptKey: number, priorText: string): NotebookState {
    const prev = notebook.scripts[scriptKey];
    return {
        ...notebook,
        scripts: {
            ...notebook.scripts,
            [scriptKey]: {
                ...prev,
                pendingDiff: { priorText, diffBuffer: { destroy: () => { } } } as any,
            },
        },
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
        mockState.agentRuns.clear();
        mockState.observedWidth = 1200;
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
            active: true,
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
            value: '02-script.sql',
        });
        expect(showDetails).toHaveBeenCalledTimes(1);
    });

    it('keeps the read-only preview (with a diff overlay) while an agent rewrite is pending', () => {
        renderFeed({
            notebook: withPendingDiff(createNotebookState(), 101, 'select 0'),
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        // The staged diff no longer swaps the compact preview for the editable editor: the entry
        // keeps its preview and overlays the rewrite as a compact in-place diff. Both entries still
        // render a preview; the only editor is the compose card.
        expect(container.querySelectorAll('[data-testid="script-preview"]').length).toBe(2);
        expect(container.querySelectorAll('[data-testid="script-editor"]').length).toBe(1);
    });

    it('expands into details when a pending-diff card body is clicked', () => {
        const modifyNotebook = vi.fn();
        const showDetails = vi.fn();
        renderFeed({
            notebook: withPendingDiff(createNotebookState(), 101, 'select 0'),
            modifyNotebook,
            showDetails,
            scrollTarget: null,
        });

        // Clicking a pending-diff card body now expands to Details (where the full normal-text diff
        // and its own Accept/Reject controls live) — the old expansion guard is gone.
        const previews = container.querySelectorAll('[data-testid="script-preview"]');
        act(() => {
            previews[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
        });

        expect(modifyNotebook).toHaveBeenCalledWith({
            type: SELECT_ENTRY,
            value: '01-script.sql',
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
            value: '01-script.sql',
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

    it('suppresses Ctrl+E when the compose editor is focused', () => {
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const handler = mockState.keyHandlers.find(candidate => candidate.key === 'e' && candidate.ctrlKey === true && candidate.capture === true);
        expect(handler).toBeDefined();

        const stopPropagation = vi.fn();
        act(() => {
            handler!.callback({ stopPropagation } as unknown as KeyboardEvent);
        });

        expect(stopPropagation).toHaveBeenCalledTimes(1);
    });

    it('does not suppress Ctrl+E when the compose editor is not focused', () => {
        mockState.composeEditorFocused = false;
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const handler = mockState.keyHandlers.find(candidate => candidate.key === 'e' && candidate.ctrlKey === true && candidate.capture === true);
        expect(handler).toBeDefined();

        const stopPropagation = vi.fn();
        act(() => {
            handler!.callback({ stopPropagation } as unknown as KeyboardEvent);
        });

        expect(stopPropagation).not.toHaveBeenCalled();
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
            scrollTarget: { fileName: '02-script.sql', version: 1 },
        });

        expect(mockState.scrollToRowMock).toHaveBeenCalledWith({
            index: 2,
            align: 'start',
        });
    });

    it('does not scroll when only the focused entry changes (e.g. hover-driven SELECT_ENTRY)', () => {
        // Simulate a keyboard nav that set scrollTarget to '01-script.sql', then a
        // hover that changed focus to '02-script.sql' without bumping the scroll target.
        const notebook = createNotebookState();
        const scrollTarget = { fileName: '01-script.sql', version: 1 };

        renderFeed({
            notebook,
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget,
        });

        mockState.scrollToRowMock.mockClear();

        // Re-render with the same scrollTarget reference but a different focused file
        // (mimicking a hover-triggered SELECT_ENTRY that the parent did not promote
        // to a new scroll request).
        renderFeed({
            notebook: {
                ...notebook,
                notebookUserFocus: { ...notebook.notebookUserFocus, fileName: '02-script.sql' },
            },
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget,
        });

        expect(mockState.scrollToRowMock).not.toHaveBeenCalled();
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

    it('shows execution footer for an agent run without a query', () => {
        // The script references a run by id; the run (resolved from the registry) carries the trace.
        // Terminal phase (SUCCEEDED) so the in-flight AI bar isn't what surfaces the footer here.
        mockState.agentRuns.set(5, { traceId: 200, phase: 6 /* SUCCEEDED */, log: [{ message: 'Done' }] });
        const notebook = createNotebookState();
        notebook.scripts[101] = { ...notebook.scripts[101], latestAgentRunId: 5 };
        renderFeed({
            notebook,
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        const viewers = container.querySelectorAll('[data-testid="trace-log-viewer"]');
        expect(viewers.length).toBe(1);
        expect(viewers[0].getAttribute('data-trace-id')).toBe('200');
    });

    it('shows the status bar with the latest log line while an agent run is active', () => {
        // An active run (non-terminal phase) renders the clickable status bar showing the latest
        // log message; the body still shows the current output rather than the raw trace.
        mockState.agentRuns.set(7, {
            traceId: 200,
            phase: 2 /* GENERATING */,
            log: [{ message: 'Starting agent run' }, { message: 'Generating a SQL query from your request' }],
        });
        const notebook = createNotebookState();
        notebook.scripts[101] = { ...notebook.scripts[101], latestAgentRunId: 7 };
        renderFeed({
            notebook,
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        const statusBar = container.querySelector('[aria-label="Show log"]');
        expect(statusBar).not.toBeNull();
        expect(statusBar!.textContent).toContain('Generating a SQL query from your request');
        // The staged-rewrite editor is not mounted for an active run — only the compose editor is.
        expect(container.querySelectorAll('[data-testid="script-editor"]').length).toBe(1);
    });

    it('shows the status bar with the query status text while a query is running', () => {
        // With no active agent run, the same status bar surfaces query execution progress: a spinner
        // plus the human-readable status text (status 4 = RUNNING → "Executing query").
        mockState.queryStates.set(42, { traceId: 100, status: 4 /* RUNNING */ });
        const notebook = createNotebookState();
        notebook.scripts[101] = { ...notebook.scripts[101], latestQueryId: 42 };
        renderFeed({
            notebook,
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        const statusBar = container.querySelector('[aria-label="Show log"]');
        expect(statusBar).not.toBeNull();
        expect(statusBar!.textContent).toContain('Executing query');
    });

    it('hides the status bar once a query succeeds', () => {
        // Per the auto-hide behavior, a succeeded query shows no status bar (the Data tab conveys
        // success); the footer still renders.
        mockState.queryStates.set(42, { traceId: 100, status: 9 /* SUCCEEDED */ });
        const notebook = createNotebookState();
        notebook.scripts[101] = { ...notebook.scripts[101], latestQueryId: 42 };
        renderFeed({
            notebook,
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        expect(container.querySelector('[aria-label="Show log"]')).toBeNull();
    });

    it('shows Accept/Reject in the status bar once a rewrite is staged', () => {
        // A finished run that left a pending diff: the status bar turns into the Accept/Reject controls.
        mockState.agentRuns.set(8, { traceId: 200, phase: 6 /* SUCCEEDED */, log: [{ message: 'Done' }] });
        let notebook = withPendingDiff(createNotebookState(), 101, 'select 0');
        notebook.scripts[101] = { ...notebook.scripts[101], latestAgentRunId: 8 };
        renderFeed({
            notebook,
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        // The status bar renders the Details-style check/cross icon group, so Accept/Reject are
        // identified by their aria-label rather than button text.
        expect(container.querySelector('[aria-label="Accept rewrite"]')).not.toBeNull();
        expect(container.querySelector('[aria-label="Reject rewrite"]')).not.toBeNull();
        // No running spinner strip while a rewrite is staged.
        expect(container.querySelector('[aria-label="Show log"]')).toBeNull();
    });

    it('dispatches ACCEPT_PENDING_DIFF when the status bar Accept button is clicked', () => {
        const modifyNotebook = vi.fn();
        renderFeed({
            notebook: withPendingDiff(createNotebookState(), 101, 'select 0'),
            modifyNotebook,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const acceptButton = container.querySelector('[aria-label="Accept rewrite"]');
        expect(acceptButton).not.toBeNull();
        act(() => {
            (acceptButton as HTMLButtonElement).click();
        });

        expect(modifyNotebook).toHaveBeenCalledWith({ type: ACCEPT_PENDING_DIFF, value: 101 });
    });

    it('dispatches REJECT_PENDING_DIFF when the status bar Reject button is clicked', () => {
        const modifyNotebook = vi.fn();
        renderFeed({
            notebook: withPendingDiff(createNotebookState(), 101, 'select 0'),
            modifyNotebook,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const rejectButton = container.querySelector('[aria-label="Reject rewrite"]');
        expect(rejectButton).not.toBeNull();
        act(() => {
            (rejectButton as HTMLButtonElement).click();
        });

        expect(modifyNotebook).toHaveBeenCalledWith({ type: REJECT_PENDING_DIFF, value: 101 });
    });

    it('accepts a staged rewrite on the focused entry with plain Enter', () => {
        // Focus is on '01-script.sql' (scriptKey 101) by default. Nothing else is focused, so the
        // plain-Enter handler accepts the pending diff instead of opening Details.
        const modifyNotebook = vi.fn();
        const showDetails = vi.fn();
        renderFeed({
            notebook: withPendingDiff(createNotebookState(), 101, 'select 0'),
            modifyNotebook,
            showDetails,
            scrollTarget: null,
        });

        const handler = mockState.keyHandlers.find(c => c.key === 'Enter' && c.ctrlKey === false && c.capture === true);
        expect(handler).toBeDefined();

        const preventDefault = vi.fn();
        act(() => {
            handler!.callback({ preventDefault } as unknown as KeyboardEvent);
        });

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(modifyNotebook).toHaveBeenCalledWith({ type: ACCEPT_PENDING_DIFF, value: 101 });
        // Enter accepts the rewrite here; it must not also open Details.
        expect(showDetails).not.toHaveBeenCalled();
    });

    it('rejects a staged rewrite on the focused entry with Escape', () => {
        const modifyNotebook = vi.fn();
        renderFeed({
            notebook: withPendingDiff(createNotebookState(), 101, 'select 0'),
            modifyNotebook,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const handler = mockState.keyHandlers.find(c => c.key === 'Escape' && c.ctrlKey === false && c.capture === true);
        expect(handler).toBeDefined();

        const preventDefault = vi.fn();
        act(() => {
            handler!.callback({ preventDefault } as unknown as KeyboardEvent);
        });

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(modifyNotebook).toHaveBeenCalledWith({ type: REJECT_PENDING_DIFF, value: 101 });
    });

    it('Escape steps from the overview grid back to the feed before escaping the notebook', () => {
        const modifyNotebook = vi.fn();
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        // The overview toggle is offered on wide boards; switch into the grid.
        const toggle = container.querySelector('[aria-label="Show overview"]') as HTMLButtonElement | null;
        expect(toggle).not.toBeNull();
        act(() => {
            toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(container.querySelector('[data-testid="page-overview"]')).not.toBeNull();

        // First Escape drops back to the feed and swallows the event so the page-level handler
        // (which would leave the notebook) never sees it.
        const handler = mockState.keyHandlers.find(c => c.key === 'Escape' && c.ctrlKey === false && c.capture === true);
        expect(handler).toBeDefined();
        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();
        act(() => {
            handler!.callback({ preventDefault, stopPropagation } as unknown as KeyboardEvent);
        });

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(stopPropagation).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="page-overview"]')).toBeNull();
        // Leaving the grid must not reject a diff or otherwise mutate the notebook.
        expect(modifyNotebook).not.toHaveBeenCalled();
    });

    it('opens details on plain Enter when the focused entry has no pending rewrite', () => {
        const modifyNotebook = vi.fn();
        const showDetails = vi.fn();
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook,
            showDetails,
            scrollTarget: null,
        });

        const handler = mockState.keyHandlers.find(c => c.key === 'Enter' && c.ctrlKey === false && c.capture === true);
        expect(handler).toBeDefined();

        const preventDefault = vi.fn();
        act(() => {
            handler!.callback({ preventDefault } as unknown as KeyboardEvent);
        });

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(showDetails).toHaveBeenCalledTimes(1);
        expect(modifyNotebook).not.toHaveBeenCalledWith(expect.objectContaining({ type: ACCEPT_PENDING_DIFF }));
    });

    it('leaves the focused entry alone when Enter/Escape fire with a focused element', () => {
        // A rename input / compose editor holding focus owns ⏎/⎋; the feed's handlers must bail.
        const modifyNotebook = vi.fn();
        const showDetails = vi.fn();
        renderFeed({
            notebook: withPendingDiff(createNotebookState(), 101, 'select 0'),
            modifyNotebook,
            showDetails,
            scrollTarget: null,
        });

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        expect(document.activeElement).toBe(input);

        const enter = mockState.keyHandlers.find(c => c.key === 'Enter' && c.ctrlKey === false && c.capture === true);
        const escape = mockState.keyHandlers.find(c => c.key === 'Escape' && c.ctrlKey === false && c.capture === true);
        const preventDefault = vi.fn();
        act(() => {
            enter!.callback({ preventDefault } as unknown as KeyboardEvent);
            escape!.callback({ preventDefault } as unknown as KeyboardEvent);
        });

        expect(preventDefault).not.toHaveBeenCalled();
        expect(modifyNotebook).not.toHaveBeenCalled();
        expect(showDetails).not.toHaveBeenCalled();
        input.remove();
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
