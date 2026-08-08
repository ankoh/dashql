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
} from '../../../test/view_mocks.js';

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
    storageBackend: {
        deleteQueryResultCache: vi.fn(),
        listQueryResultCache: vi.fn(async () => [] as Array<{ name: string }>),
    },
    cacheKey: null as string | null,
    cachedFiles: [] as Array<{ name: string }>,
    previewReady: true,
}));
vi.mock('../../../app_config.js', () => ({ useAppConfig: () => ({ settings: {} }) }));
vi.mock('../../../platform/ai_client_provider.js', () => ({ useAIClient: () => ({}) }));
vi.mock('react-window', async () => fakeReactWindowModule(await import('react'), mockState.scrollToRowMock));
vi.mock('../script_editor.js', async () => fakeScriptEditorModule(await import('react'), mockState));
vi.mock('../prompt_editor.js', async () => {
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
vi.mock('../script_preview.js', async () => fakeScriptPreviewModule(await import('react'), mockState));
vi.mock('../../foundations/button.js', async () => fakeButtonModule(await import('react')));
vi.mock('../../foundations/status_indicator.js', async () => fakeStatusIndicatorModule(await import('react')));
vi.mock('../../foundations/symbol_icon.js', async () => fakeSymbolIconModule(await import('react')));
vi.mock('../../foundations/size_observer.js', () => ({
    observeSize: () => ({ width: mockState.observedWidth, height: 480 }),
}));
vi.mock('../../../utils/scrollbar.js', () => fakeScrollbarModule());
vi.mock('../../../utils/key_events.js', () => ({
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
vi.mock('../../../scripts/notebook_commands.js', async () => {
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
vi.mock('../../../connection/query_executor.js', () => ({
    useQueryState: (_notebookId: string | null, queryId: number | null) => {
        if (queryId == null) return null;
        return mockState.queryStates.get(queryId) ?? null;
    },
    useQueryExecutor: () => mockState.executeQuery,
    useCancelQuery: () => mockState.cancelQuery,
    computeQueryCacheKeyForConnection: vi.fn(async (_details, queryText: string) =>
        queryText === 'select 1' ? mockState.cacheKey : null),
}));
vi.mock('../../../platform/storage/storage_provider.js', () => ({
    useStorageReader: () => ({ backend: mockState.storageBackend }),
}));
vi.mock('../../../agent/agent_run_provider.js', () => ({
    // Resolve an agent run by its id from the backing map, mirroring useQueryState.
    useAgentRunState: (runId: number | null) => {
        if (runId == null) return null;
        return mockState.agentRuns.get(runId) ?? null;
    },
    useLatestAgentRunState: () => mockState.latestAgentRunId == null ? null : mockState.agentRuns.get(mockState.latestAgentRunId) ?? null,
    useStartAgentRun: () => mockState.startAgentRun,
    useCancelAgentRun: () => mockState.cancelAgentRun,
}));
vi.mock('../../internals/trace_log_viewer.js', async () => {
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


import {
    ACCEPT_PENDING_DIFF,
    DELETE_SCRIPT,
    PROMOTE_UNCOMMITTED_SCRIPT,
    REJECT_PENDING_DIFF,
    REGISTER_QUERY,
    REORDER_SCRIPTS,
    SELECT_SCRIPT,
    type NotebookScripts,
} from '../../../scripts/notebook_scripts.js';
import { ConnectionHealth, type ConnectionState } from '../../../connection/connection_state.js';
import { NotebookFeed } from './notebook_feed.js';

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

function createNotebookScripts(): NotebookScripts {
    return {
        notebookId: crypto.randomUUID(),
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
        scriptFolders: {
            'Main': {
                folderName: 'Main',
                scripts: {
                    '01-script.sql': { scriptId: 101, fileName: '01-script.sql' },
                    '02-script.sql': { scriptId: 102, fileName: '02-script.sql' },
                },
            },
        },
        scriptFocus: {
            folderName: 'Main',
            fileName: '01-script.sql',
            interactionCounter: 0,
        },
        semanticUserFocus: null,
    };
}

function appendCommittedEntry(notebookScripts: NotebookScripts): NotebookScripts {
    const main = notebookScripts.scriptFolders['Main'];
    return {
        ...notebookScripts,
        scripts: {
            ...notebookScripts.scripts,
            103: makeScriptData(103, 'select 3', '03-script.sql', 'Main'),
        },
        scriptFolders: {
            ...notebookScripts.scriptFolders,
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
function withPendingDiff(notebookScripts: NotebookScripts, scriptKey: number, priorText: string): NotebookScripts {
    const prev = notebookScripts.scripts[scriptKey];
    return {
        ...notebookScripts,
        scripts: {
            ...notebookScripts.scripts,
            [scriptKey]: {
                ...prev,
                pendingDiff: { priorText, diffBuffer: { destroy: () => { } } } as any,
            },
        },
    };
}

describe('NotebookFeed', () => {
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
        mockState.storageBackend.deleteQueryResultCache.mockReset();
        mockState.storageBackend.listQueryResultCache.mockReset();
        mockState.storageBackend.listQueryResultCache.mockImplementation(async () => mockState.cachedFiles);
        mockState.cacheKey = null;
        mockState.cachedFiles = [];
        mockState.previewReady = true;
        ResizeObserverMock.reset();
        getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const scriptId = this.closest<HTMLElement>('[data-row-script-id]')?.dataset.rowScriptId;
            const paddingTop = Number.parseFloat(this.style.paddingTop) || 0;
            const height = (scriptId === '101' ? 200 : scriptId === '102' ? 300 : 0) + paddingTop;
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

    function renderFeed(props: Partial<React.ComponentProps<typeof NotebookFeed>> & {
        notebookScripts: NotebookScripts;
        modifyNotebookScripts: React.ComponentProps<typeof NotebookFeed>['modifyNotebookScripts'];
        showDetails: React.ComponentProps<typeof NotebookFeed>['showDetails'];
    }) {
        const fullProps: React.ComponentProps<typeof NotebookFeed> = {
            scrollTarget: null,
            conn: createOnlineConnection(),
            openConnectionOverlay: () => { },
            active: true,
            ...props,
        };
        act(() => {
            root.render(<NotebookFeed {...fullProps} />);
        });
    }

    it('keeps the draft fixed and exposes the list scrollbar inset for card centering', () => {
        renderFeed({
            notebookScripts: createNotebookScripts(),
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
        });

        const list = container.querySelector('[data-testid="mock-list"]') as HTMLDivElement;
        const composer = list.parentElement?.nextElementSibling as HTMLDivElement | null;

        expect(list.style.scrollbarGutter).toBe('stable');
        expect(list.style.overflowX).toBe('hidden');
        expect(list.style.getPropertyValue('--feed-scrollbar-inset')).toBe('17px');
        expect(list.parentElement?.parentElement?.style.getPropertyValue('--feed-scrollbar-inset')).toBe('17px');
        if (composer == null) throw new Error('missing draft composer');
        expect(composer.style.right).toBe('');
    });

    it('dispatches SELECT_SCRIPT and shows details when a preview is activated', () => {
        const modifyNotebookScripts = vi.fn();
        const showDetails = vi.fn();
        renderFeed({
            notebookScripts: createNotebookScripts(),
            modifyNotebookScripts,
            showDetails,
            scrollTarget: null,
        });

        act(() => {
            container.querySelectorAll('[data-testid="script-preview"]')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(modifyNotebookScripts).toHaveBeenCalledWith({
            type: SELECT_SCRIPT,
            value: '02-script.sql',
        });
        expect(showDetails).toHaveBeenCalledWith('02-script.sql');
    });

    it('renders execute and AI context controls instead of the focus indicator', () => {
        renderFeed({ notebookScripts: createNotebookScripts(), modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

        const executeButtons = container.querySelectorAll('[aria-label="Execute script query"]');
        expect(executeButtons).toHaveLength(2);
        expect(executeButtons[0].getAttribute('aria-current')).toBe('true');
        expect(executeButtons[1].hasAttribute('aria-current')).toBe(false);
        expect(container.querySelectorAll('[aria-label="Use script as AI context"]')).toHaveLength(2);
        expect(container.querySelector('[aria-label^="Open script"]')).toBeNull();
    });

    it('moves the Ctrl+E indicator to the newly focused card', () => {
        const notebookScripts = createNotebookScripts();
        renderFeed({ notebookScripts, modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

        renderFeed({
            notebookScripts: {
                ...notebookScripts,
                scriptFocus: { ...notebookScripts.scriptFocus, fileName: '02-script.sql' },
            },
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
        });

        const executeButtons = container.querySelectorAll('[aria-label="Execute script query"]');
        expect(executeButtons[0].hasAttribute('aria-current')).toBe(false);
        expect(executeButtons[1].getAttribute('aria-current')).toBe('true');
    });

    it('executes the clicked script without changing notebookScripts focus', () => {
        const notebookScripts = createNotebookScripts();
        const modifyNotebookScripts = vi.fn();
        renderFeed({ notebookScripts, modifyNotebookScripts, showDetails: vi.fn() });

        const executeButtons = container.querySelectorAll('[aria-label="Execute script query"]');
        act(() => (executeButtons[1] as HTMLButtonElement).click());

        expect(mockState.executeQuery).toHaveBeenCalledWith(notebookScripts.notebookId, expect.objectContaining({
            query: 'select 2',
            cacheable: true,
        }));
        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: REGISTER_QUERY, value: [102, 42] });
        expect(modifyNotebookScripts).not.toHaveBeenCalledWith(expect.objectContaining({ type: SELECT_SCRIPT }));
    });

    it('replaces execute with stop while that script query is active', () => {
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[101] = { ...notebookScripts.scripts[101], latestQueryId: 42 };
        mockState.queryStates.set(42, { traceId: 100, status: 4 /* RUNNING */ });
        renderFeed({ notebookScripts, modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

        expect(container.querySelectorAll('[aria-label="Execute script query"]')).toHaveLength(1);
        const stop = container.querySelector('[aria-label="Stop script query"]') as HTMLButtonElement;
        expect(stop).not.toBeNull();
        act(() => stop.click());
        expect(mockState.cancelQuery).toHaveBeenCalledWith(notebookScripts.notebookId, 42);
        expect(mockState.executeQuery).not.toHaveBeenCalled();
    });

    it('disables card execution while disconnected', () => {
        renderFeed({ notebookScripts: createNotebookScripts(), modifyNotebookScripts: vi.fn(), showDetails: vi.fn(), conn: null });

        const executeButtons = container.querySelectorAll('[aria-label="Execute script query"]');
        expect(executeButtons).toHaveLength(2);
        expect(Array.from(executeButtons).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    });

    it('disables only an unresolved VISUALIZE entry instead of crashing the feed', () => {
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[101] = makeScriptData(
            101,
            'visualize dashql.script."Missing/source" using vegalite ( mark => bar )',
            '01-script.sql',
            'Main',
        );

        expect(() => renderFeed({ notebookScripts, modifyNotebookScripts: vi.fn(), showDetails: vi.fn() })).not.toThrow();

        const executeButtons = container.querySelectorAll('[aria-label="Execute script query"]');
        expect(executeButtons).toHaveLength(2);
        expect((executeButtons[0] as HTMLButtonElement).disabled).toBe(true);
        expect((executeButtons[1] as HTMLButtonElement).disabled).toBe(false);
    });

    it('switches to AI, focuses the prompt, and shows the clicked script as context', () => {
        renderFeed({ notebookScripts: createNotebookScripts(), modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

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
        const notebookScripts = createNotebookScripts();
        mockState.promptText = 'Improve this query';
        const modifyNotebookScripts = vi.fn();
        renderFeed({ notebookScripts, modifyNotebookScripts, showDetails: vi.fn() });

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
        renderFeed({ notebookScripts: createNotebookScripts(), modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

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
        renderFeed({ notebookScripts: createNotebookScripts(), modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });
        const contextButton = container.querySelector('[aria-label="Use script as AI context"]') as HTMLButtonElement;
        act(() => contextButton.click());

        expect(container.querySelector('[title="script"]')?.textContent).toContain('script');
        const remove = container.querySelector('[aria-label="Remove script AI context"]') as HTMLButtonElement;
        expect(remove).not.toBeNull();
        act(() => remove.click());
        expect(container.querySelector('[aria-label="Remove script AI context"]')).toBeNull();
    });

    it('keeps AI context across mode switches and clears it when the script is deleted', () => {
        const notebookScripts = createNotebookScripts();
        renderFeed({ notebookScripts, modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });
        act(() => (container.querySelector('[aria-label="Use script as AI context"]') as HTMLButtonElement).click());

        const sqlModeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'SQL');
        act(() => (sqlModeButton as HTMLButtonElement).click());
        const aiModeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'AI');
        act(() => (aiModeButton as HTMLButtonElement).click());
        expect(container.querySelector('[aria-label="Remove script AI context"]')).not.toBeNull();

        const page = notebookScripts.scriptFolders.Main;
        const scripts = { ...notebookScripts.scripts };
        delete scripts[101];
        renderFeed({
            notebookScripts: {
                ...notebookScripts,
                scripts,
                scriptFolders: {
                    Main: {
                        ...page,
                        scripts: { '02-script.sql': page.scripts['02-script.sql'] },
                    },
                },
            },
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
        });
        expect(container.querySelector('[aria-label="Remove script AI context"]')).toBeNull();
    });

    it('does not open Details when a story SQL control is activated', () => {
        const notebookScripts = createNotebookScripts();
        const modifyNotebookScripts = vi.fn();
        const showDetails = vi.fn();
        renderFeed({ notebookScripts, modifyNotebookScripts, showDetails });
        const control = container.querySelector('[data-dashql-story-control]') as HTMLButtonElement;
        act(() => {
            control.click();
        });
        expect(showDetails).not.toHaveBeenCalled();
        expect(modifyNotebookScripts).not.toHaveBeenCalledWith(expect.objectContaining({ type: SELECT_SCRIPT }));
    });

    it('keeps the read-only preview (with a diff overlay) while an agent rewrite is pending', () => {
        renderFeed({
            notebookScripts: withPendingDiff(createNotebookScripts(), 101, 'select 0'),
            modifyNotebookScripts: vi.fn(),
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
        const modifyNotebookScripts = vi.fn();
        const showDetails = vi.fn();
        renderFeed({
            notebookScripts: withPendingDiff(createNotebookScripts(), 101, 'select 0'),
            modifyNotebookScripts,
            showDetails,
            scrollTarget: null,
        });

        // Clicking a pending-diff card body now expands to Details (where the full normal-text diff
        // and its own Accept/Reject controls live) — the old expansion guard is gone.
        act(() => {
            container.querySelectorAll('[data-testid="script-preview"]')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(modifyNotebookScripts).toHaveBeenCalledWith({
            type: SELECT_SCRIPT,
            value: '01-script.sql',
        });
        expect(showDetails).toHaveBeenCalledWith('01-script.sql');
    });

    it('dispatches DELETE_SCRIPT when delete is clicked', () => {
        const modifyNotebookScripts = vi.fn();
        renderFeed({
            notebookScripts: createNotebookScripts(),
            modifyNotebookScripts,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const deleteButtons = container.querySelectorAll('[aria-label="Delete script"]');
        expect(deleteButtons.length).toBe(2);

        act(() => {
            (deleteButtons[0] as HTMLButtonElement).click();
        });

        expect(modifyNotebookScripts).toHaveBeenCalledWith({
            type: DELETE_SCRIPT,
            value: '01-script.sql',
        });
    });

    it('reorders the complete script pair from the script-card arrows', () => {
        const modifyNotebookScripts = vi.fn();
        renderFeed({
            notebookScripts: createNotebookScripts(),
            modifyNotebookScripts,
            showDetails: vi.fn(),
        });

        const moveDownButtons = container.querySelectorAll('[aria-label="Move script down"]');
        expect(moveDownButtons).toHaveLength(2);
        act(() => (moveDownButtons[0] as HTMLButtonElement).click());

        expect(modifyNotebookScripts).toHaveBeenCalledWith({
            type: REORDER_SCRIPTS,
            value: { folderName: 'Main', fileNames: ['02-script.sql', '01-script.sql'] },
        });
    });

    it('keeps the compose send control available while a query is running', () => {
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[101] = { ...notebookScripts.scripts[101], latestQueryId: 42 };
        const modifyNotebookScripts = vi.fn();
        mockState.queryStates.set(42, { traceId: 100, status: 4 /* RUNNING */ });
        renderFeed({
            notebookScripts,
            modifyNotebookScripts,
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
        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
    });

    it('saves the draft without executing it', () => {
        const modifyNotebookScripts = vi.fn();
        renderFeed({
            notebookScripts: createNotebookScripts(),
            modifyNotebookScripts,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const saveButton = container.querySelector('[aria-label="Save"]') as HTMLButtonElement;
        expect(saveButton).not.toBeNull();

        act(() => {
            saveButton.click();
        });

        expect(modifyNotebookScripts).toHaveBeenCalledWith({
            type: PROMOTE_UNCOMMITTED_SCRIPT,
            value: null,
        });
        expect(mockState.executeQuery).not.toHaveBeenCalled();
    });

    it('saves and executes the draft when Execute is clicked', () => {
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[notebookScripts.uncommittedScriptId] = makeScriptData(notebookScripts.uncommittedScriptId, 'select 3');
        const modifyNotebookScripts = vi.fn();
        renderFeed({ notebookScripts, modifyNotebookScripts, showDetails: vi.fn() });

        const executeButton = container.querySelector('[aria-label="Execute"]') as HTMLButtonElement;
        expect(executeButton).not.toBeNull();

        act(() => executeButton.click());

        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
        expect(mockState.executeQuery).toHaveBeenCalledOnce();
    });

    it('keeps Save available and disables Execute while disconnected', () => {
        renderFeed({
            notebookScripts: createNotebookScripts(),
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
            conn: null,
        });

        const saveButton = container.querySelector('[aria-label="Save"]') as HTMLButtonElement;
        const executeButton = container.querySelector('[aria-label="Execute"]') as HTMLButtonElement;
        expect(saveButton.disabled).toBe(false);
        expect(executeButton.disabled).toBe(true);
    });

    it('dispatches PROMOTE_UNCOMMITTED_SCRIPT on Ctrl+Enter when the compose editor is focused', () => {
        const modifyNotebookScripts = vi.fn();
        renderFeed({
            notebookScripts: createNotebookScripts(),
            modifyNotebookScripts,
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
        expect(modifyNotebookScripts).toHaveBeenCalledWith({
            type: PROMOTE_UNCOMMITTED_SCRIPT,
            value: null,
        });
    });

    it('does not send on Ctrl+Enter when the compose editor is not focused', () => {
        mockState.composeEditorFocused = false;
        const modifyNotebookScripts = vi.fn();
        renderFeed({
            notebookScripts: createNotebookScripts(),
            modifyNotebookScripts,
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
        expect(modifyNotebookScripts).not.toHaveBeenCalledWith({
            type: PROMOTE_UNCOMMITTED_SCRIPT,
            value: null,
        });
    });

    it('suppresses Ctrl+E when the compose editor is focused', () => {
        renderFeed({
            notebookScripts: createNotebookScripts(),
            modifyNotebookScripts: vi.fn(),
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
            notebookScripts: createNotebookScripts(),
            modifyNotebookScripts: vi.fn(),
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
        const notebookScripts = createNotebookScripts();
        const modifyNotebookScripts = vi.fn();
        const showDetails = vi.fn();

        renderFeed({
            notebookScripts,
            modifyNotebookScripts,
            showDetails,
            scrollTarget: null,
        });

        mockState.scrollToRowMock.mockClear();

        renderFeed({
            notebookScripts,
            modifyNotebookScripts,
            showDetails,
            scrollTarget: { fileName: '02-script.sql', version: 1 },
        });

        expect(mockState.scrollToRowMock).toHaveBeenCalledWith({
            index: 1,
            align: 'start',
        });
    });

    it('scrolls the first entry to its leading padding', () => {
        const notebookScripts = createNotebookScripts();
        renderFeed({ notebookScripts, modifyNotebookScripts: vi.fn(), showDetails: vi.fn(), scrollTarget: null });
        mockState.scrollToRowMock.mockClear();

        renderFeed({
            notebookScripts,
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: { fileName: '01-script.sql', version: 1 },
        });

        expect(mockState.scrollToRowMock).toHaveBeenCalledWith({ index: 0, align: 'start' });
        const rows = container.querySelector('[data-testid="mock-list"]')!.children;
        expect(rows).toHaveLength(3);
        expect((rows[0].firstElementChild as HTMLElement).style.paddingTop).toBe('24px');
    });

    it('scrolls to the top when a folder navigation requests page zero', () => {
        const notebookScripts = createNotebookScripts();
        renderFeed({ notebookScripts, modifyNotebookScripts: vi.fn(), showDetails: vi.fn(), scrollTarget: null });
        mockState.scrollToRowMock.mockClear();

        renderFeed({
            notebookScripts,
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: { fileName: '', version: 1 },
        });

        expect(mockState.scrollToRowMock).toHaveBeenCalledWith({ index: 0, align: 'start' });
    });

    it('memoizes measured dynamic heights by script', () => {
        const notebookScripts = createNotebookScripts();
        renderFeed({ notebookScripts, modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

        const rows = container.querySelector('[data-testid="mock-list"]')!.children;
        expect(rows[0].getAttribute('data-row-height')).toBe('224');
        expect(rows[1].getAttribute('data-row-height')).toBe('300');
        expect((rows[0].firstElementChild as HTMLElement).style.paddingTop).toBe('24px');

        getBoundingClientRect.mockClear();
        renderFeed({ notebookScripts, modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

        expect(rows[0].getAttribute('data-row-height')).toBe('224');
        expect(rows[1].getAttribute('data-row-height')).toBe('300');
        expect(getBoundingClientRect).not.toHaveBeenCalled();
    });

    it('uses smaller padding before the first feed entry on mobile', () => {
        mockState.observedWidth = 700;
        renderFeed({ notebookScripts: createNotebookScripts(), modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

        const rows = container.querySelector('[data-testid="mock-list"]')!.children;
        expect(rows[0].getAttribute('data-row-height')).toBe('208');
        expect((rows[0].firstElementChild as HTMLElement).style.paddingTop).toBe('8px');
    });

    it('retains a cached row height while its preview remounts', () => {
        const notebookScripts = createNotebookScripts();
        renderFeed({ notebookScripts, modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

        mockState.previewReady = false;
        const main = notebookScripts.scriptFolders.Main;
        renderFeed({
            notebookScripts: {
                ...notebookScripts,
                scriptFolders: {
                    Main: {
                        ...main,
                        scripts: {
                            '01-script.sql': main.scripts['02-script.sql'],
                            '02-script.sql': main.scripts['01-script.sql'],
                        },
                    },
                },
            },
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
        });

        const remountingRow = container.querySelector<HTMLElement>('[data-row-script-id="101"] > div');
        expect(remountingRow).not.toBeNull();
        expect(remountingRow!.style.height).toBe('auto');
        expect(remountingRow!.style.minHeight).toBe('200px');
    });

    it('updates a memoized row when result content grows', () => {
        const notebookScripts = createNotebookScripts();
        renderFeed({ notebookScripts, modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

        const rows = container.querySelector('[data-testid="mock-list"]')!.children;
        expect(rows[0].getAttribute('data-row-height')).toBe('224');

        getBoundingClientRect.mockImplementation(function (this: HTMLElement) {
            const scriptId = this.closest<HTMLElement>('[data-row-script-id]')?.dataset.rowScriptId;
            const paddingTop = Number.parseFloat(this.style.paddingTop) || 0;
            return { height: (scriptId === '101' ? 460 : 300) + paddingTop } as DOMRect;
        });
        act(() => ResizeObserverMock.triggerAll());

        expect(rows[0].getAttribute('data-row-height')).toBe('484');
    });

    it('allows a row to shrink when rerunning unchanged SQL', () => {
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[101] = { ...notebookScripts.scripts[101], latestQueryId: 41 };
        mockState.queryStates.set(41, { traceId: 100, status: 9 /* SUCCEEDED */ });
        renderFeed({ notebookScripts, modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

        const rows = container.querySelector('[data-testid="mock-list"]')!.children;
        expect(rows[0].getAttribute('data-row-height')).toBe('224');

        // A rerun replaces the result footer but does not change or remount the SQL preview.
        // Therefore no new preview-ready notification is required before accepting the shrink.
        mockState.previewReady = false;
        mockState.queryStates.set(42, { traceId: 101, status: 4 /* RUNNING */ });
        getBoundingClientRect.mockImplementation(function (this: HTMLElement) {
            const scriptId = this.closest<HTMLElement>('[data-row-script-id]')?.dataset.rowScriptId;
            const paddingTop = Number.parseFloat(this.style.paddingTop) || 0;
            return { height: (scriptId === '101' ? 120 : 300) + paddingTop } as DOMRect;
        });
        renderFeed({
            notebookScripts: {
                ...notebookScripts,
                scripts: {
                    ...notebookScripts.scripts,
                    101: { ...notebookScripts.scripts[101], latestQueryId: 42 },
                },
            },
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
        });
        act(() => ResizeObserverMock.triggerAll());

        expect(rows[0].getAttribute('data-row-height')).toBe('144');
    });

    it('allows result growth while a remounted preview is still formatting', () => {
        const notebookScripts = createNotebookScripts();
        renderFeed({ notebookScripts, modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

        const rows = container.querySelector('[data-testid="mock-list"]')!.children;
        expect(rows[0].getAttribute('data-row-height')).toBe('224');

        mockState.previewReady = false;
        const main = notebookScripts.scriptFolders.Main;
        renderFeed({
            notebookScripts: {
                ...notebookScripts,
                scriptFolders: {
                    Main: {
                        ...main,
                        scripts: {
                            '01-script.sql': main.scripts['02-script.sql'],
                            '02-script.sql': main.scripts['01-script.sql'],
                        },
                    },
                },
            },
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
        });

        getBoundingClientRect.mockImplementation(function (this: HTMLElement) {
            const scriptId = this.closest<HTMLElement>('[data-row-script-id]')?.dataset.rowScriptId;
            const paddingTop = Number.parseFloat(this.style.paddingTop) || 0;
            return { height: (scriptId === '101' ? 520 : 300) + paddingTop } as DOMRect;
        });
        act(() => ResizeObserverMock.triggerAll());

        expect(rows[1].getAttribute('data-row-height')).toBe('520');
    });

    it('does not scroll when only the focused entry changes (e.g. hover-driven SELECT_SCRIPT)', () => {
        // Simulate a keyboard nav that set scrollTarget to '01-script.sql', then a
        // hover that changed focus to '02-script.sql' without bumping the scroll target.
        const notebookScripts = createNotebookScripts();
        const scrollTarget = { fileName: '01-script.sql', version: 1 };

        renderFeed({
            notebookScripts,
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget,
        });

        mockState.scrollToRowMock.mockClear();

        // Re-render with the same scrollTarget reference but a different focused file
        // (mimicking a hover-triggered SELECT_SCRIPT that the parent did not promote
        // to a new scroll request).
        renderFeed({
            notebookScripts: {
                ...notebookScripts,
                scriptFocus: { ...notebookScripts.scriptFocus, fileName: '02-script.sql' },
            },
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget,
        });

        expect(mockState.scrollToRowMock).not.toHaveBeenCalled();
    });

    it('does not show execution footer when latestQueryId is null', () => {
        renderFeed({
            notebookScripts: createNotebookScripts(),
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        const viewers = container.querySelectorAll('[data-testid="trace-log-viewer"]');
        expect(viewers.length).toBe(0);
        expect(container.textContent).toContain('Not run yet');
        expect(container.textContent).not.toContain('Result is cached');
    });

    it('renders a script and server card for every notebookScripts entry', () => {
        renderFeed({
            notebookScripts: createNotebookScripts(),
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
        });

        expect(container.querySelectorAll('[data-testid="script-preview"]')).toHaveLength(2);
        expect(container.textContent?.match(/Not run yet/g)).toHaveLength(2);
    });

    it('does not execute statements when cards render', () => {
        renderFeed({ notebookScripts: createNotebookScripts(), modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

        expect(mockState.executeQuery).not.toHaveBeenCalled();
    });

    it('marks only cards whose query result is cached', async () => {
        mockState.cacheKey = 'cached-query';
        mockState.cachedFiles = [{ name: 'cached-query.arrow' }];
        renderFeed({ notebookScripts: createNotebookScripts(), modifyNotebookScripts: vi.fn(), showDetails: vi.fn() });

        await act(async () => { await Promise.resolve(); });

        expect(container.textContent?.match(/Cached/g)).toHaveLength(1);
        expect(container.textContent?.match(/Not run yet/g)).toHaveLength(2);
        expect(container.textContent).not.toContain('Result is cached');
        expect(mockState.executeQuery).not.toHaveBeenCalled();
    });

    it('shows execution footer when a query is running', () => {
        mockState.queryStates.set(42, { traceId: 100, status: 4 /* RUNNING */ });
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[101] = { ...notebookScripts.scripts[101], latestQueryId: 42 };
        renderFeed({
            notebookScripts,
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        const viewers = container.querySelectorAll('[data-testid="trace-log-viewer"]');
        expect(viewers.length).toBe(1);
        expect(viewers[0].getAttribute('data-trace-id')).toBe('100');
    });

    it('keeps execution footer after query succeeds', () => {
        mockState.queryStates.set(42, { traceId: 100, status: 9 /* SUCCEEDED */ });
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[101] = { ...notebookScripts.scripts[101], latestQueryId: 42 };
        renderFeed({
            notebookScripts,
            modifyNotebookScripts: vi.fn(),
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
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[101] = { ...notebookScripts.scripts[101], latestAgentRunId: 5 };
        renderFeed({
            notebookScripts,
            modifyNotebookScripts: vi.fn(),
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
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[101] = { ...notebookScripts.scripts[101], latestAgentRunId: 7 };
        renderFeed({
            notebookScripts,
            modifyNotebookScripts: vi.fn(),
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
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[101] = { ...notebookScripts.scripts[101], latestQueryId: 42 };
        renderFeed({
            notebookScripts,
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        const statusBar = container.querySelector('[aria-label^="Show log"]');
        expect(statusBar).not.toBeNull();
        expect(statusBar!.textContent).toContain('Executing query');
        const cancel = container.querySelector('[aria-label="Cancel query"]') as HTMLButtonElement;
        expect(cancel).not.toBeNull();
        act(() => cancel.click());
        expect(mockState.cancelQuery).toHaveBeenCalledWith(notebookScripts.notebookId, 42);
    });

    it('keeps the status bar once a query succeeds', () => {
        mockState.queryStates.set(42, { traceId: 100, status: 9 /* SUCCEEDED */ });
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[101] = { ...notebookScripts.scripts[101], latestQueryId: 42 };
        renderFeed({
            notebookScripts,
            modifyNotebookScripts: vi.fn(),
            showDetails: vi.fn(),
            scrollTarget: null,
        });
        const statusBar = container.querySelector('[aria-label^="Show log"]');
        expect(statusBar).not.toBeNull();
        expect(statusBar!.textContent).toContain('Statement executed successfully');
    });

    it('shows that a successful query result was loaded from cache', () => {
        mockState.queryStates.set(42, { traceId: 100, status: 9 /* SUCCEEDED */, servedFromCache: true });
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[101] = { ...notebookScripts.scripts[101], latestQueryId: 42 };
        renderFeed({
            notebookScripts,
            modifyNotebookScripts: vi.fn(),
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
        let notebookScripts = withPendingDiff(createNotebookScripts(), 101, 'select 0');
        notebookScripts.scripts[101] = { ...notebookScripts.scripts[101], latestAgentRunId: 8 };
        renderFeed({
            notebookScripts,
            modifyNotebookScripts: vi.fn(),
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
        let notebookScripts = withPendingDiff(createNotebookScripts(), 101, 'select 0');
        notebookScripts.scripts[101] = { ...notebookScripts.scripts[101], latestQueryId: 42 };
        renderFeed({
            notebookScripts,
            modifyNotebookScripts: vi.fn(),
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
        const modifyNotebookScripts = vi.fn();
        renderFeed({
            notebookScripts: withPendingDiff(createNotebookScripts(), 101, 'select 0'),
            modifyNotebookScripts,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const acceptButton = container.querySelector('[aria-label="Accept rewrite"]');
        expect(acceptButton).not.toBeNull();
        act(() => {
            (acceptButton as HTMLButtonElement).click();
        });

        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: ACCEPT_PENDING_DIFF, value: 101 });
    });

    it('dispatches REJECT_PENDING_DIFF when the status bar Reject button is clicked', () => {
        const modifyNotebookScripts = vi.fn();
        renderFeed({
            notebookScripts: withPendingDiff(createNotebookScripts(), 101, 'select 0'),
            modifyNotebookScripts,
            showDetails: vi.fn(),
            scrollTarget: null,
        });

        const rejectButton = container.querySelector('[aria-label="Reject rewrite"]');
        expect(rejectButton).not.toBeNull();
        act(() => {
            (rejectButton as HTMLButtonElement).click();
        });

        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: REJECT_PENDING_DIFF, value: 101 });
    });

    it('accepts a staged rewrite on the focused entry with plain Enter', () => {
        // Focus is on '01-script.sql' (scriptKey 101) by default. Nothing else is focused, so the
        // plain-Enter handler accepts the pending diff instead of opening Details.
        const modifyNotebookScripts = vi.fn();
        const showDetails = vi.fn();
        renderFeed({
            notebookScripts: withPendingDiff(createNotebookScripts(), 101, 'select 0'),
            modifyNotebookScripts,
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
        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: ACCEPT_PENDING_DIFF, value: 101 });
        // Enter accepts the rewrite here; it must not also open Details.
        expect(showDetails).not.toHaveBeenCalled();
    });

    it('rejects a staged rewrite on the focused entry with Escape', () => {
        const modifyNotebookScripts = vi.fn();
        renderFeed({
            notebookScripts: withPendingDiff(createNotebookScripts(), 101, 'select 0'),
            modifyNotebookScripts,
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
        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: REJECT_PENDING_DIFF, value: 101 });
    });

    it('does nothing on plain Enter when the focused entry has no pending rewrite', () => {
        const modifyNotebookScripts = vi.fn();
        const showDetails = vi.fn();
        renderFeed({
            notebookScripts: createNotebookScripts(),
            modifyNotebookScripts,
            showDetails,
            scrollTarget: null,
        });

        const handler = mockState.keyHandlers.find(c => c.key === 'Enter' && c.ctrlKey === false && c.capture === true);
        expect(handler).toBeDefined();

        const preventDefault = vi.fn();
        act(() => {
            handler!.callback({ preventDefault } as unknown as KeyboardEvent);
        });

        expect(preventDefault).not.toHaveBeenCalled();
        expect(showDetails).not.toHaveBeenCalled();
        expect(modifyNotebookScripts).not.toHaveBeenCalledWith(expect.objectContaining({ type: ACCEPT_PENDING_DIFF }));
    });

    it('leaves the focused entry alone when Enter/Escape fire with a focused element', () => {
        // A rename input / compose editor holding focus owns ⏎/⎋; the feed's handlers must bail.
        const modifyNotebookScripts = vi.fn();
        const showDetails = vi.fn();
        renderFeed({
            notebookScripts: withPendingDiff(createNotebookScripts(), 101, 'select 0'),
            modifyNotebookScripts,
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
        expect(modifyNotebookScripts).not.toHaveBeenCalled();
        expect(showDetails).not.toHaveBeenCalled();
        input.remove();
    });

    it('scrolls to the bottom after send once the promoted entry appears', () => {
        let notebookScripts = createNotebookScripts();
        const modifyNotebookScripts = vi.fn();
        const showDetails = vi.fn();

        renderFeed({
            notebookScripts,
            modifyNotebookScripts,
            showDetails,
            scrollTarget: null,
        });

        const executeButton = container.querySelector('[aria-label="Execute"]') as HTMLButtonElement;
        expect(executeButton).not.toBeNull();

        act(() => {
            executeButton.click();
        });

        mockState.scrollToRowMock.mockClear();
        notebookScripts = appendCommittedEntry(notebookScripts);

        renderFeed({
            notebookScripts,
            modifyNotebookScripts,
            showDetails,
            scrollTarget: null,
        });

        expect(mockState.scrollToRowMock).toHaveBeenCalledWith({
            index: 3,
            align: 'end',
        });
    });
});
