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
    IntersectionObserverMock,
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
    queryStates: new Map<number, { traceId: number; status: number; servedFromCache?: boolean }>(),
    agentRuns: new Map<number, { traceId: number; phase?: number; log?: Array<{ message: string }> }>(),
    latestAgentRunId: null as number | null,
    observedWidth: 1200,
    promptText: '',
    composeEditorFocus: vi.fn(),
    executeQuery: vi.fn(),
    startAgentRun: vi.fn(),
    cancelAgentRun: vi.fn(),
    cancelQuery: vi.fn(),
}));
vi.mock('../../platform/ai_client_provider.js', () => ({ useAIClient: () => ({}) }));
vi.mock('react-window', async () => fakeReactWindowModule(await import('react'), mockState.scrollToRowMock));
vi.mock('./script_editor.js', async () => fakeScriptEditorModule(await import('react'), mockState));
vi.mock('./prompt_editor.js', async () => {
    const React = await import('react');
    return {
        PromptEditor: (props: { setView?: (view: unknown) => void }) => {
            React.useEffect(() => {
                props.setView?.({
                    hasFocus: mockState.composeEditorFocused,
                    focus: mockState.composeEditorFocus,
                    state: {
                        doc: {
                            length: mockState.promptText.length,
                            toString: () => mockState.promptText,
                        },
                    },
                    dispatch: vi.fn(),
                });
            }, [props.setView]);
            return React.createElement('div', { 'data-testid': 'prompt-editor' }, 'prompt editor');
        },
    };
});
vi.mock('./notebook_script_preview.js', async () => fakeScriptPreviewModule(await import('react')));
vi.mock('../foundations/button.js', async () => fakeButtonModule(await import('react')));
vi.mock('../foundations/status_indicator.js', async () => fakeStatusIndicatorModule(await import('react')));
vi.mock('../foundations/symbol_icon.js', async () => fakeSymbolIconModule(await import('react')));
vi.mock('../foundations/size_observer.js', () => ({
    observeSize: () => ({ width: mockState.observedWidth, height: 480 }),
}));
vi.mock('../../utils/scrollbar.js', () => fakeScrollbarModule());
vi.mock('../../utils/key_events.js', () => ({
    // The real hook keeps each call site's subscribers independent (every component that calls it
    // installs its own document listeners), so multiple components in the tree register in parallel —
    // e.g. the feed's handlers plus a nested Tooltip's Escape. The mock must not let a
    // nested component's registration clobber the feed's, yet must keep the feed's *latest* closures
    // as it re-renders (its handlers close over state like the compose editor view, set post-mount).
    // Model that by keying on the handler signature and keeping the most recent one per signature:
    // a re-render replaces its own same-signature handlers, while a distinct signature (the Tooltip's
    // capture-less Escape) coexists. `beforeEach` clears this back to `[]` per test.
    useKeyEvents: (handlers: typeof mockState.keyHandlers) => {
        const sig = (h: (typeof handlers)[number]) => `${h.key}/${h.ctrlKey}/${h.capture}`;
        const next = mockState.keyHandlers.filter(existing => !handlers.some(h => sig(h) === sig(existing)));
        mockState.keyHandlers = [...next, ...handlers];
    },
}));
vi.mock('../../notebook/notebook_commands.js', async () => {
    const React = await import('react');
    return {
        NotebookCommandType: { ExecuteEditorQuery: 1 },
        COMPOSE_INPUT_MODE_AI: 1,
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
    useQueryExecutor: () => mockState.executeQuery,
    useCancelQuery: () => mockState.cancelQuery,
}));
vi.mock('../../platform/storage/storage_provider.js', () => ({
    useStorageReader: () => ({ backend: { deleteQueryResultCache: vi.fn() } }),
}));
vi.mock('../../agent/agent_run_provider.js', () => ({
    // Resolve an agent run by its id from the backing map, mirroring useQueryState.
    useAgentRunState: (runId: number | null) => {
        if (runId == null) return null;
        return mockState.agentRuns.get(runId) ?? null;
    },
    useLatestAgentRunState: () => mockState.latestAgentRunId == null ? null : mockState.agentRuns.get(mockState.latestAgentRunId) ?? null,
    useStartAgentRun: () => mockState.startAgentRun,
    useCancelAgentRun: () => mockState.cancelAgentRun,
}));
vi.mock('../internals/trace_log_viewer.js', async () => {
    const React = await import('react');
    return {
        TraceLogViewer: (props: { traceId?: number; height?: number; maxRows?: number }) =>
            React.createElement('div', { 'data-testid': 'trace-log-viewer', 'data-trace-id': props.traceId }),
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
vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);


import {
    ACCEPT_PENDING_DIFF,
    DELETE_NOTEBOOK_ENTRY,
    PROMOTE_UNCOMMITTED_SCRIPT,
    REJECT_PENDING_DIFF,
    REGISTER_QUERY,
    REORDER_NOTEBOOK_SCRIPTS,
    SELECT_ENTRY,
    type NotebookState,
} from '../../notebook/notebook_state.js';
import { ConnectionHealth, type ConnectionState } from '../../connection/connection_state.js';
import { NotebookScriptFeed } from './notebook_script_feed.js';

function createOnlineConnection(activeQueryIds: number[] = []): ConnectionState {
    return {
        connectionHealth: ConnectionHealth.ONLINE,
        queriesActive: new Map(activeQueryIds.map(id => [id, {}])),
        queriesActiveOrdered: activeQueryIds,
    } as unknown as ConnectionState;
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
    let getBoundingClientRect: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        mockState.scrollToRowMock.mockReset();
        mockState.composeEditorFocused = true;
        mockState.keyHandlers = [];
        mockState.queryStates.clear();
        mockState.agentRuns.clear();
        mockState.latestAgentRunId = null;
        mockState.observedWidth = 1200;
        mockState.promptText = '';
        mockState.composeEditorFocus.mockReset();
        mockState.executeQuery.mockReset();
        mockState.executeQuery.mockReturnValue([42, Promise.resolve(null)]);
        mockState.startAgentRun.mockReset();
        mockState.cancelAgentRun.mockReset();
        mockState.cancelQuery.mockReset();
        getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const scriptId = this.closest<HTMLElement>('[data-row-script-id]')?.dataset.rowScriptId;
            const height = scriptId === '101' ? 200 : scriptId === '102' ? 300 : 0;
            return { height } as DOMRect;
        });
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        getBoundingClientRect.mockRestore();
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

    it('keeps the draft fixed and exposes the list scrollbar inset for card centering', () => {
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
        });

        const list = container.querySelector('[data-testid="mock-list"]') as HTMLDivElement;
        const composer = list.parentElement?.nextElementSibling as HTMLDivElement | null;

        expect(list.style.scrollbarGutter).toBe('stable');
        expect(list.style.overflowX).toBe('hidden');
        expect(list.style.getPropertyValue('--feed-scrollbar-inset')).toBe('17px');
        if (composer == null) throw new Error('missing draft composer');
        expect(composer.style.right).toBe('');
    });

    it('dispatches SELECT_ENTRY and shows details when a preview is activated', () => {
        const modifyNotebook = vi.fn();
        const showDetails = vi.fn();
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook,
            showDetails,
            scrollTarget: null,
        });

        act(() => {
            container.querySelectorAll('[data-testid="script-preview"]')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(modifyNotebook).toHaveBeenCalledWith({
            type: SELECT_ENTRY,
            value: '02-script.sql',
        });
        expect(showDetails).toHaveBeenCalledWith('02-script.sql');
    });

    it('renders execute and AI context controls instead of the focus indicator', () => {
        renderFeed({ notebook: createNotebookState(), modifyNotebook: vi.fn(), showDetails: vi.fn() });

        const executeButtons = container.querySelectorAll('[aria-label="Execute script query"]');
        expect(executeButtons).toHaveLength(2);
        expect(executeButtons[0].getAttribute('aria-current')).toBe('true');
        expect(executeButtons[1].hasAttribute('aria-current')).toBe(false);
        expect(container.querySelectorAll('[aria-label="Use script as AI context"]')).toHaveLength(2);
        expect(container.querySelector('[aria-label^="Open script"]')).toBeNull();
    });

    it('moves the Ctrl+E indicator to the newly focused card', () => {
        const notebook = createNotebookState();
        renderFeed({ notebook, modifyNotebook: vi.fn(), showDetails: vi.fn() });

        renderFeed({
            notebook: {
                ...notebook,
                notebookUserFocus: { ...notebook.notebookUserFocus, fileName: '02-script.sql' },
            },
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
        });

        const executeButtons = container.querySelectorAll('[aria-label="Execute script query"]');
        expect(executeButtons[0].hasAttribute('aria-current')).toBe(false);
        expect(executeButtons[1].getAttribute('aria-current')).toBe('true');
    });

    it('executes the clicked script without changing notebook focus', () => {
        const notebook = createNotebookState();
        const modifyNotebook = vi.fn();
        renderFeed({ notebook, modifyNotebook, showDetails: vi.fn() });

        const executeButtons = container.querySelectorAll('[aria-label="Execute script query"]');
        act(() => (executeButtons[1] as HTMLButtonElement).click());

        expect(mockState.executeQuery).toHaveBeenCalledWith(notebook.sessionId, expect.objectContaining({
            query: 'select 2',
            cacheable: true,
        }));
        expect(modifyNotebook).toHaveBeenCalledWith({ type: REGISTER_QUERY, value: [102, 42] });
        expect(modifyNotebook).not.toHaveBeenCalledWith(expect.objectContaining({ type: SELECT_ENTRY }));
    });

    it('replaces execute with stop while that script query is active', () => {
        const notebook = createNotebookState();
        notebook.scripts[101] = { ...notebook.scripts[101], latestQueryId: 42 };
        mockState.queryStates.set(42, { traceId: 100, status: 4 /* RUNNING */ });
        renderFeed({ notebook, modifyNotebook: vi.fn(), showDetails: vi.fn() });

        expect(container.querySelectorAll('[aria-label="Execute script query"]')).toHaveLength(1);
        const stop = container.querySelector('[aria-label="Stop script query"]') as HTMLButtonElement;
        expect(stop).not.toBeNull();
        act(() => stop.click());
        expect(mockState.cancelQuery).toHaveBeenCalledWith(notebook.sessionId, 42);
        expect(mockState.executeQuery).not.toHaveBeenCalled();
    });

    it('disables card execution while disconnected', () => {
        renderFeed({ notebook: createNotebookState(), modifyNotebook: vi.fn(), showDetails: vi.fn(), conn: null });

        const executeButtons = container.querySelectorAll('[aria-label="Execute script query"]');
        expect(executeButtons).toHaveLength(2);
        expect(Array.from(executeButtons).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    });

    it('disables only an unresolved VISUALIZE entry instead of crashing the feed', () => {
        const notebook = createNotebookState();
        notebook.scripts[101] = makeScriptData(
            101,
            'visualize dashql.notebook."Missing/source" using vegalite ( mark => bar )',
            '01-script.sql',
            'Main',
        );

        expect(() => renderFeed({ notebook, modifyNotebook: vi.fn(), showDetails: vi.fn() })).not.toThrow();

        const executeButtons = container.querySelectorAll('[aria-label="Execute script query"]');
        expect(executeButtons).toHaveLength(2);
        expect((executeButtons[0] as HTMLButtonElement).disabled).toBe(true);
        expect((executeButtons[1] as HTMLButtonElement).disabled).toBe(false);
    });

    it('switches to AI, focuses the prompt, and shows the clicked script as context', () => {
        renderFeed({ notebook: createNotebookState(), modifyNotebook: vi.fn(), showDetails: vi.fn() });

        const contextButtons = container.querySelectorAll('[aria-label="Use script as AI context"]');
        act(() => (contextButtons[1] as HTMLButtonElement).click());

        expect(container.querySelector('[data-testid="prompt-editor"]')).not.toBeNull();
        expect(container.textContent).toContain('script');
        expect(container.querySelector('[aria-label="Remove script AI context"]')).not.toBeNull();
        expect(mockState.composeEditorFocus).toHaveBeenCalledOnce();

        const refreshedContextButtons = container.querySelectorAll('[aria-label="Use script as AI context"]');
        act(() => (refreshedContextButtons[0] as HTMLButtonElement).click());
        expect(mockState.composeEditorFocus).toHaveBeenCalledTimes(2);
    });

    it('runs the AI prompt against the explicit context despite later hover selection', () => {
        const notebook = createNotebookState();
        mockState.promptText = 'Improve this query';
        const modifyNotebook = vi.fn();
        renderFeed({ notebook, modifyNotebook, showDetails: vi.fn() });

        const contextButtons = container.querySelectorAll('[aria-label="Use script as AI context"]');
        act(() => (contextButtons[1] as HTMLButtonElement).click());
        act(() => {
            container.querySelectorAll('[data-testid="script-preview"]')[0].parentElement?.parentElement?.parentElement
                ?.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true }));
        });
        act(() => (container.querySelector('[aria-label="Send to AI"]') as HTMLButtonElement).click());

        expect(mockState.startAgentRun).toHaveBeenCalledWith(expect.objectContaining({
            prompt: 'Improve this query',
            contextScriptKey: 102,
        }));
    });

    it('uses a blank-draft context when AI mode has no context bean', () => {
        mockState.promptText = 'Create a query';
        renderFeed({ notebook: createNotebookState(), modifyNotebook: vi.fn(), showDetails: vi.fn() });

        const aiModeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'AI');
        expect(aiModeButton).toBeDefined();
        act(() => (aiModeButton as HTMLButtonElement).click());
        act(() => (container.querySelector('[aria-label="Send to AI"]') as HTMLButtonElement).click());

        expect(mockState.startAgentRun).toHaveBeenCalledWith(expect.objectContaining({
            prompt: 'Create a query',
            contextScriptKey: null,
        }));
    });

    it('removes the explicit AI context from the composer bean', () => {
        renderFeed({ notebook: createNotebookState(), modifyNotebook: vi.fn(), showDetails: vi.fn() });
        const contextButton = container.querySelector('[aria-label="Use script as AI context"]') as HTMLButtonElement;
        act(() => contextButton.click());

        expect(container.querySelector('[title="script"]')?.textContent).toContain('script');
        const remove = container.querySelector('[aria-label="Remove script AI context"]') as HTMLButtonElement;
        expect(remove).not.toBeNull();
        act(() => remove.click());
        expect(container.querySelector('[aria-label="Remove script AI context"]')).toBeNull();
    });

    it('keeps AI context across mode switches and clears it when the script is deleted', () => {
        const notebook = createNotebookState();
        renderFeed({ notebook, modifyNotebook: vi.fn(), showDetails: vi.fn() });
        act(() => (container.querySelector('[aria-label="Use script as AI context"]') as HTMLButtonElement).click());

        const sqlModeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'SQL');
        act(() => (sqlModeButton as HTMLButtonElement).click());
        const aiModeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'AI');
        act(() => (aiModeButton as HTMLButtonElement).click());
        expect(container.querySelector('[aria-label="Remove script AI context"]')).not.toBeNull();

        const page = notebook.notebookPages.Main;
        const scripts = { ...notebook.scripts };
        delete scripts[101];
        renderFeed({
            notebook: {
                ...notebook,
                scripts,
                notebookPages: {
                    Main: {
                        ...page,
                        scripts: { '02-script.sql': page.scripts['02-script.sql'] },
                    },
                },
            },
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
        });
        expect(container.querySelector('[aria-label="Remove script AI context"]')).toBeNull();
    });

    it('does not open Details when a story SQL control is activated', () => {
        const notebook = createNotebookState();
        const modifyNotebook = vi.fn();
        const showDetails = vi.fn();
        renderFeed({ notebook, modifyNotebook, showDetails });
        const control = container.querySelector('[data-dashql-story-control]') as HTMLButtonElement;
        act(() => {
            control.click();
        });
        expect(showDetails).not.toHaveBeenCalled();
        expect(modifyNotebook).not.toHaveBeenCalledWith(expect.objectContaining({ type: SELECT_ENTRY }));
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
        act(() => {
            container.querySelectorAll('[data-testid="script-preview"]')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(modifyNotebook).toHaveBeenCalledWith({
            type: SELECT_ENTRY,
            value: '01-script.sql',
        });
        expect(showDetails).toHaveBeenCalledWith('01-script.sql');
    });

    it('dispatches DELETE_NOTEBOOK_ENTRY when delete is clicked', () => {
        const modifyNotebook = vi.fn();
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const deleteButtons = container.querySelectorAll('[aria-label="Delete script"]');
        expect(deleteButtons.length).toBe(2);

        act(() => {
            (deleteButtons[0] as HTMLButtonElement).click();
        });

        expect(modifyNotebook).toHaveBeenCalledWith({
            type: DELETE_NOTEBOOK_ENTRY,
            value: '01-script.sql',
        });
    });

    it('reorders the complete script pair from the script-card arrows', () => {
        const modifyNotebook = vi.fn();
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook,
            showDetails: vi.fn(),
        });

        const moveDownButtons = container.querySelectorAll('[aria-label="Move script down"]');
        expect(moveDownButtons).toHaveLength(2);
        act(() => (moveDownButtons[0] as HTMLButtonElement).click());

        expect(modifyNotebook).toHaveBeenCalledWith({
            type: REORDER_NOTEBOOK_SCRIPTS,
            value: ['02-script.sql', '01-script.sql'],
        });
    });

    it('keeps the compose send control available while a query is running', () => {
        const notebook = createNotebookState();
        notebook.scripts[101] = { ...notebook.scripts[101], latestQueryId: 42 };
        const modifyNotebook = vi.fn();
        mockState.queryStates.set(42, { traceId: 100, status: 4 /* RUNNING */ });
        renderFeed({
            notebook,
            modifyNotebook,
            showDetails: vi.fn(),
            conn: createOnlineConnection([42]),
        });

        expect(container.querySelector('[aria-label="Stop query"]')).toBeNull();
        // Every server card now has a status indicator: one running query and one neutral
        // "Not run yet" entry in this fixture.
        expect(container.querySelectorAll('[data-testid="status-indicator"]').length).toBe(2);
        const execute = container.querySelector('[aria-label="Execute"]') as HTMLButtonElement;
        expect(execute).not.toBeNull();
        act(() => execute.click());
        expect(modifyNotebook).toHaveBeenCalledWith({ type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
    });

    it('saves the draft without executing it', () => {
        const modifyNotebook = vi.fn();
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const saveButton = container.querySelector('[aria-label="Save"]') as HTMLButtonElement;
        expect(saveButton).not.toBeNull();

        act(() => {
            saveButton.click();
        });

        expect(modifyNotebook).toHaveBeenCalledWith({
            type: PROMOTE_UNCOMMITTED_SCRIPT,
            value: null,
        });
        expect(mockState.executeQuery).not.toHaveBeenCalled();
    });

    it('saves and executes the draft when Execute is clicked', () => {
        const notebook = createNotebookState();
        notebook.scripts[notebook.uncommittedScriptId] = makeScriptData(notebook.uncommittedScriptId, 'select 3');
        const modifyNotebook = vi.fn();
        renderFeed({ notebook, modifyNotebook, showDetails: vi.fn() });

        const executeButton = container.querySelector('[aria-label="Execute"]') as HTMLButtonElement;
        expect(executeButton).not.toBeNull();

        act(() => executeButton.click());

        expect(modifyNotebook).toHaveBeenCalledWith({ type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
        expect(mockState.executeQuery).toHaveBeenCalledOnce();
    });

    it('keeps Save available and disables Execute while disconnected', () => {
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            conn: null,
        });

        const saveButton = container.querySelector('[aria-label="Save"]') as HTMLButtonElement;
        const executeButton = container.querySelector('[aria-label="Execute"]') as HTMLButtonElement;
        expect(saveButton.disabled).toBe(false);
        expect(executeButton.disabled).toBe(true);
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

    it('keeps measured heights with their scripts when feed order changes', () => {
        const notebook = createNotebookState();
        renderFeed({ notebook, modifyNotebook: vi.fn(), showDetails: vi.fn() });

        const list = container.querySelector('[data-testid="mock-list"]')!;
        expect(list.children[1].getAttribute('data-row-height')).toBe('200');
        expect(list.children[2].getAttribute('data-row-height')).toBe('300');

        const main = notebook.notebookPages.Main;
        renderFeed({
            notebook: {
                ...notebook,
                notebookPages: {
                    ...notebook.notebookPages,
                    Main: {
                        ...main,
                        scripts: {
                            '01-script.sql': main.scripts['01-script.sql'],
                            '00-script.sql': { scriptId: 102, fileName: '00-script.sql' },
                        },
                    },
                },
            },
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
        });

        expect(list.children[1].getAttribute('data-row-height')).toBe('300');
        expect(list.children[2].getAttribute('data-row-height')).toBe('200');
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
        expect(container.textContent).toContain('Not run yet');
    });

    it('renders a script and server card for every notebook entry', () => {
        renderFeed({
            notebook: createNotebookState(),
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
        });

        expect(container.querySelectorAll('[data-testid="script-preview"]')).toHaveLength(2);
        expect(container.textContent?.match(/Not run yet/g)).toHaveLength(2);
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
        const statusBar = container.querySelector('[aria-label^="Show log"]');
        expect(statusBar).not.toBeNull();
        expect(statusBar!.textContent).toContain('Generating a SQL query from your request');
        expect(container.querySelector('[aria-label="Cancel agent run"]')).not.toBeNull();
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
        const statusBar = container.querySelector('[aria-label^="Show log"]');
        expect(statusBar).not.toBeNull();
        expect(statusBar!.textContent).toContain('Executing query');
        const cancel = container.querySelector('[aria-label="Cancel query"]') as HTMLButtonElement;
        expect(cancel).not.toBeNull();
        act(() => cancel.click());
        expect(mockState.cancelQuery).toHaveBeenCalledWith(notebook.sessionId, 42);
    });

    it('keeps the status bar once a query succeeds', () => {
        mockState.queryStates.set(42, { traceId: 100, status: 9 /* SUCCEEDED */ });
        const notebook = createNotebookState();
        notebook.scripts[101] = { ...notebook.scripts[101], latestQueryId: 42 };
        renderFeed({
            notebook,
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        const statusBar = container.querySelector('[aria-label^="Show log"]');
        expect(statusBar).not.toBeNull();
        expect(statusBar!.textContent).toContain('Statement executed successfully');
    });

    it('shows that a successful query result was loaded from cache', () => {
        mockState.queryStates.set(42, { traceId: 100, status: 9 /* SUCCEEDED */, servedFromCache: true });
        const notebook = createNotebookState();
        notebook.scripts[101] = { ...notebook.scripts[101], latestQueryId: 42 };
        renderFeed({
            notebook,
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        const statusBar = container.querySelector('[aria-label^="Show log"]');
        expect(statusBar).not.toBeNull();
        expect(statusBar!.textContent).toContain('Result loaded from cache');
    });

    it('shows Accept/Reject on the body once a rewrite is staged', () => {
        // A finished run that left a pending diff: the body gets the Accept/Reject overlay. The
        // rewrite does not override the status bar; the completed agent state remains visible while
        // Accept/Reject stays attached to the body diff.
        mockState.agentRuns.set(8, { traceId: 200, phase: 6 /* SUCCEEDED */, log: [{ message: 'Done' }] });
        let notebook = withPendingDiff(createNotebookState(), 101, 'select 0');
        notebook.scripts[101] = { ...notebook.scripts[101], latestAgentRunId: 8 };
        renderFeed({
            notebook,
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        // The body overlay renders the Details-style check/cross icon group, so Accept/Reject are
        // identified by their aria-label rather than button text.
        expect(container.querySelector('[aria-label="Accept rewrite"]')).not.toBeNull();
        expect(container.querySelector('[aria-label="Reject rewrite"]')).not.toBeNull();
        // The completed agent run remains available as the server card status.
        expect(container.querySelector('[aria-label^="Show log"]')).not.toBeNull();
    });

    it('shows the query status bar when a re-execution runs over a staged diff', () => {
        // The agent's edit re-executes the script: while that query is in flight it takes the status
        // bar and surfaces its progress, even though a rewrite is still pending Accept/Reject.
        mockState.queryStates.set(42, { traceId: 100, status: 4 /* RUNNING */ });
        let notebook = withPendingDiff(createNotebookState(), 101, 'select 0');
        notebook.scripts[101] = { ...notebook.scripts[101], latestQueryId: 42 };
        renderFeed({
            notebook,
            modifyNotebook: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        // The bar is the clickable execution strip showing the running query...
        const statusBar = container.querySelector('[aria-label^="Show log"]');
        expect(statusBar).not.toBeNull();
        expect(statusBar!.textContent).toContain('Executing query');
        // ...and Accept/Reject stay reachable on the body overlay throughout.
        expect(container.querySelector('[aria-label="Accept rewrite"]')).not.toBeNull();
        expect(container.querySelector('[aria-label="Reject rewrite"]')).not.toBeNull();
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
        expect(showDetails).toHaveBeenCalledWith('01-script.sql');
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

        const executeButton = container.querySelector('[aria-label="Execute"]') as HTMLButtonElement;
        expect(executeButton).not.toBeNull();

        act(() => {
            executeButton.click();
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
