import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dashql from '@ankoh/dashql-core';
import { ScriptFeedRow, type ScriptFeedRowDependencies } from './session_feed_row.js';
import { ConnectorType } from '../../../connections/connector_info.js';
import { ConnectionHealth } from '../../../connections/connection_state.js';
import { SessionConnectionAttentionContext } from '../session_connection_attention.js';
import { SessionDataCard, type SessionDataCardProps } from './session_data_card.js';
import { HYPER_CONNECTOR, TRINO_CONNECTOR } from '../../../connections/connector_info.js';
import { LoggerProvider } from '../../../../platform/logger/logger_provider.js';
import { WebFileDownloader } from '../../../../platform/file/web_file_downloader.js';
import { SessionTestBackend } from '../../../storage/session_test_backend.js';
import { SessionFeed, type SessionFeedDependencies } from './session_feed.js';
import { SessionComposerVariant, type SessionComposerProps } from './session_composer.js';
import { ComposerInputMode } from '../../ai/input_mode.js';
import type { AgentRunListener } from '../../../agent/agent_bridge.js';
import { AgentConnectionStatus } from '../../../../platform/agent/agent_client.js';
import { CREATE_SCRIPT, SET_SCRIPT_TEXT, type SessionScripts } from '../../scripts/session_scripts.js';
import { CONNECTOR_INFOS } from '../../../connections/connector_info.js';
import { hyperOPFSRoot } from '../../../../platform/opfs_root.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = { query: null as any, sortableTransform: null as any, formatScriptEditor: vi.fn() };
const dependencies = {
    useSortable: () => ({
        attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: state.sortableTransform, transition: undefined, isDragging: false,
    }),
    translateTransform: (transform: { x: number; y: number } | null) => transform == null
        ? undefined
        : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    scriptCard: {
        useQueryState: () => state.query,
        useCancelQuery: () => vi.fn(),
        computeQueryCacheKeyForConnection: vi.fn(),
        ScriptEditor: (props: any) => {
            React.useEffect(() => props.setView?.({}), [props.setView]);
            return <div data-testid="editor" />;
        },
        ScriptDiagnosticsButton: () => <button>diagnostics</button>,
        ScriptStatisticsBar: () => null,
        isScriptFormattable: () => true,
        formatScriptEditor: (...args: any[]) => {
            state.formatScriptEditor(...args);
            args[3]('SELECT 1;');
        },
        CachedResultBean: () => null,
        QueryResultCacheLabel: () => null,
        QueryResultRerunButton: () => null,
        EntryStatusBar: (props: any) => <button data-testid="status" onClick={props.onToggleExpanded}>{props.status.message}</button>,
        FeedEntryFooter: () => <div data-testid="integrated-footer">footer</div>,
    },
} as unknown as ScriptFeedRowDependencies;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

function baseProps() {
    return {
        sessionId: 'session', connections: new Map(), cacheQueryResults: false,
        storageReader: { backend: { hasCachedQueryResult: vi.fn() }, getSessionLocation: () => ({ type: 'opfs' }) },
        entries: [{ scriptId: 1, fileName: '01_alpha.sql' }, { scriptId: 2, fileName: '02_beta.sql' }],
        scripts: { 1: script(1, '01_alpha.sql'), 2: script(2, '02_beta.sql') }, scriptDebugMode: false, formattingDebugMode: false,
        keywordCase: dashql.buffers.formatting.KeywordCase.UPPER,
        focusedFileName: '01_alpha.sql', active: true, onFocus: vi.fn(), onDelete: vi.fn(),
        onRename: vi.fn(), onPickConnection: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), onExecute: vi.fn(), onShowStatus: vi.fn(),
         onShowTable: vi.fn(), onShowVisualization: vi.fn(), onShowDetails: vi.fn(), onRerun: vi.fn(),
        onFormat: vi.fn(), onApplySnippet: vi.fn(), onAcceptDiff: vi.fn(), onRejectDiff: vi.fn(), collapsedResults: new Map(), onToggleResultExpanded: vi.fn(),
        generations: new Map(),
        onAutoCollapseResult: vi.fn(), onResetAutoCollapsedResult: vi.fn(), topPadding: 16,
        onCreate: vi.fn(), onEditorView: vi.fn(), onRowHeightChange: vi.fn(), dependencies,
    };
}

function script(scriptKey: number, fileName: string) {
    return { scriptKey, fileName, scriptSession: { getText: () => 'SELECT 1' }, analysisOutdated: true,
        annotations: {}, statistics: [], completion: null, pendingDiff: null, latestQueryId: null,
        connection: { connectionId: 'database', connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], catalog: {} } };
}

describe('V2 session feed rows', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => { state.query = null; state.sortableTransform = null; state.formatScriptEditor.mockReset(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    it('keeps the HyperDB path behind a copy action and disables every file action for non-WASM connections', () => {
        const sessionId = '12345678-1234-1234-1234-123456789abc';
        const props: SessionDataCardProps = {
            sessionId, file: { name: 'sales 2.csv', sizeBytes: 42 },
            conn: null, storageReader: { backend: new SessionTestBackend() } as any, onRemoved: vi.fn(),
        };
        for (const conn of [null,
            { details: { type: HYPER_CONNECTOR, value: { proto: { setupParams: { protocol: 'V3_HTTP' } } } } },
            { details: { type: TRINO_CONNECTOR, value: {} } },
        ]) {
            act(() => root.render(<LoggerProvider>
                <SessionDataCard {...props} conn={conn as any} />
            </LoggerProvider>));
            expect(container.textContent).not.toContain(`${hyperOPFSRoot()}/sessions/${sessionId}/attachments/sales 2.csv`);
            expect(container.textContent).toContain('sales 2.csv');
            expect(container.querySelector('[data-testid="data-file-type"]')?.textContent).toContain('CSV');
            for (const action of ['data-file-copy-path', 'data-file-download', 'data-file-remove']) {
                expect(container.querySelector<HTMLButtonElement>(`[data-testid="${action}"]`)?.disabled).toBe(true);
            }
            expect(Array.from(container.querySelectorAll('button')).every(button => button.disabled)).toBe(true);
            expect(container.querySelector('[data-testid="script-drag-handle"]')).toBeNull();
        }
    });

    it('downloads data bytes and removes the file before requesting a list refresh for HyperDB WASM', async () => {
        const backend = new SessionTestBackend();
        const bytes = new Uint8Array([0, 255, 13]);
        await backend.saveDataFile('session', 'sales.csv', bytes);
        const onRemoved = vi.fn();
        const download = vi.spyOn(WebFileDownloader.prototype, 'downloadBufferAsFile').mockResolvedValue();
        try {
            act(() => root.render(<LoggerProvider>
                <SessionDataCard sessionId="session" file={{ name: 'sales.csv', sizeBytes: 3 }}
                    conn={{ details: { type: HYPER_CONNECTOR, value: { proto: { setupParams: { protocol: 'WASM' } } } } } as any}
                    storageReader={{ backend } as any} onRemoved={onRemoved} />
            </LoggerProvider>));
            const downloadButton = container.querySelector<HTMLButtonElement>('[data-testid="data-file-download"]');
            expect(downloadButton).not.toBeNull();
            expect(Array.from(container.querySelectorAll('button')).every(button => !button.disabled)).toBe(true);
            await act(async () => { downloadButton!.click(); });
            expect(download).toHaveBeenCalledExactlyOnceWith(bytes, 'sales.csv');
            await vi.waitFor(() => expect(container.querySelector<HTMLButtonElement>('[data-testid="data-file-remove"]')!.disabled).toBe(false));
            await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="data-file-remove"]')!.click(); });
            expect(await backend.listDataFiles('session')).toEqual([]);
            expect(onRemoved).toHaveBeenCalledExactlyOnceWith();
        } finally {
            download.mockRestore();
        }
    });

    it('renders insertion separators before, between, and after flat scripts', () => {
        const props = baseProps();
        act(() => root.render(<>{[0, 2, 4].map(index => <ScriptFeedRow key={index} {...({ ...props, index, style: {} } as any)} />)}</>));
        const separators = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="script-insert"]'));
        expect(separators).toHaveLength(3);
        expect(separators[0].style.paddingTop).toBe('16px');
        act(() => separators[0].click());
        expect(props.onCreate).toHaveBeenCalledWith(0);
        act(() => separators[1].click());
        expect(props.onCreate).toHaveBeenCalledWith(1);
        act(() => separators[2].click());
        expect(props.onCreate).toHaveBeenCalledWith(2);
    });

    it('focuses on pointer entry and exposes integrated execution footer', () => {
        const props = baseProps();
        props.scripts[1] = { ...props.scripts[1], latestQueryId: 42 } as any;
        state.query = { queryId: 42, traceId: 9, status: 9, resultTable: {} };
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 1, style: {} } as any)} />));
        const article = container.querySelector('[data-testid="script-cell"]')!;
        act(() => article.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
        expect(props.onFocus).toHaveBeenCalledWith('01_alpha.sql');
        expect(container.querySelector('[data-testid="status"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="integrated-footer"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="script-drag-handle"]')).not.toBeNull();
        const moreButton = container.querySelector('[data-testid="script-more-actions"]') as HTMLButtonElement;
        expect(moreButton).not.toBeNull();
        act(() => moreButton.click());
        const compactButton = document.querySelector<HTMLButtonElement>('[data-testid="script-menu-item"][data-action="format-compact"]')!;
        expect(compactButton).not.toBeNull();
        act(() => compactButton.click());
        expect(state.formatScriptEditor).toHaveBeenCalledWith(
            expect.anything(),
            props.scripts[1],
            dashql.buffers.formatting.FormattingMode.COMPACT,
            expect.any(Function),
            false,
            dashql.buffers.formatting.KeywordCase.UPPER,
            dashql.buffers.formatting.FormattingDialect.TRINO,
        );
        expect(props.onFormat).toHaveBeenCalledWith(1, 'SELECT 1;');
        props.scripts[1] = { ...props.scripts[1], pendingDiff: {} } as any;
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 1, style: {} } as any)} />));
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="diff-accept"]')!.click());
        expect(props.onAcceptDiff).toHaveBeenCalledWith(1);
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="diff-reject"]')!.click());
        expect(props.onRejectDiff).toHaveBeenCalledWith(1);
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="script-expand"]')!.click());
        expect(props.onShowDetails).toHaveBeenCalledWith('01_alpha.sql');
        expect(container.querySelector<HTMLButtonElement>('[data-testid="script-move-up"]')?.disabled).toBe(true);
        const moveDownButton = container.querySelector<HTMLButtonElement>('[data-testid="script-move-down"]')!;
        expect(moveDownButton.disabled).toBe(false);
        act(() => moveDownButton.click());
        expect(props.onMoveDown).toHaveBeenCalledWith('01_alpha.sql');
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="script-delete"]')!.click());
        expect(props.onDelete).toHaveBeenCalledWith('01_alpha.sql');
    });

    it('offers snippets next to the delete button unless a rewrite is pending', () => {
        const props = baseProps();
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 1, style: {} } as any)} />));
        const snippets = container.querySelector<HTMLButtonElement>('[data-testid="script-snippets"]')!;
        expect(snippets.disabled).toBe(false);
        const deleteButton = container.querySelector('[data-testid="script-delete"]')!;
        expect(snippets.compareDocumentPosition(deleteButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        props.scripts[1] = { ...props.scripts[1], pendingDiff: {} } as any;
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 1, style: {} } as any)} />));
        expect(container.querySelector<HTMLButtonElement>('[data-testid="script-snippets"]')!.disabled).toBe(true);
    });

    it('shows the connection instead of the file name and edits the file in the storage view', () => {
        const props = baseProps();
        Object.assign(props, { connections: new Map([['database', {
            connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE, details: null, connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO],
            label: 'Trino Http', labelParts: { name: 'Trino', detail: 'Http' },
        }]]) });
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 1, style: {} } as any)} />));
        // The connection takes the place of the file name
        const picker = container.querySelector('[data-testid="script-connection-picker"]')!;
        expect(picker.textContent).toContain('Trino');
        expect(picker.textContent).toContain('Http');
        expect(picker.textContent).not.toContain('01_alpha');

        act(() => (container.querySelector('[data-testid="script-more-actions"]') as HTMLButtonElement).click());
        act(() => document.querySelector<HTMLButtonElement>('[data-testid="script-menu-item"][data-action="storage"]')!.click());
        const storage = document.querySelector('[data-testid="script-storage"]')!;
        expect(storage.textContent).toContain('opfs://sessions/session/scripts/01_alpha.sql');
        const input = storage.querySelector<HTMLInputElement>('[data-testid="script-file-name-input"]')!;
        expect(input.value).toBe('01_alpha.sql');
        input.value = 'report';
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
        expect(props.onRename).toHaveBeenCalledWith('01_alpha.sql', 'report');
    });

    it('keeps Play available for SQL with parser diagnostics', () => {
        const props = baseProps();
        Object.assign(props, { connections: new Map([['database', {
            connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE, details: null, connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], label: 'Trino Http',
            labelParts: { name: 'Trino', detail: 'Http' },
        }]]) });
        props.scripts[1] = { ...props.scripts[1], analysisOutdated: false,
            editorUpdate: { analysisAvailable: true }, scriptSession: { getText: () => 'SELECT * FROM t QUALIFY x = 1' } } as any;
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 1, style: {} } as any)} />));

        const play = container.querySelector('[data-testid="script-execute"]') as HTMLButtonElement;
        expect(play.disabled).toBe(false);
        act(() => play.click());
        expect(props.onExecute).toHaveBeenCalledWith('01_alpha.sql');
    });

    it('lets the virtual list observe the row content height', () => {
        const props = baseProps();
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 312 } as DOMRect);
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 1, style: {} } as any)} />));
        expect(container.querySelector<HTMLElement>('[data-testid="script-feed-row"]')!.style.height).toBe('');
        expect(props.onRowHeightChange).toHaveBeenCalledWith(1, 312);
        rect.mockRestore();
    });

    it('blocks execution offline and requests attention once per pointer entry without opening settings', () => {
        const props = baseProps();
        const request = vi.fn();
        act(() => root.render(<SessionConnectionAttentionContext.Provider value={{ sessionId: 'session', active: false, request }}>
            <ScriptFeedRow {...({ ...props, index: 1, style: {} } as any)} />
        </SessionConnectionAttentionContext.Provider>));
        const play = container.querySelector<HTMLButtonElement>('[data-testid="script-execute"]')!;
        expect(play.disabled).toBe(true);
        act(() => play.click());
        expect(props.onExecute).not.toHaveBeenCalled();
        const wrapper = container.querySelector<HTMLElement>('[data-execution-connection-blocked="true"]')!;
        expect(wrapper.contains(play)).toBe(true);
        act(() => {
            wrapper.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
            wrapper.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: play }));
            wrapper.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
        });
        expect(request).toHaveBeenCalledExactlyOnceWith('session');
        expect(wrapper.tabIndex).toBe(0);
    });

    /// Row props whose scripts can run
    function executableProps() {
        const props = baseProps();
        Object.assign(props, { connections: new Map([['database', {
            connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE, details: null, connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], label: 'Trino Http',
            labelParts: { name: 'Trino', detail: 'Http' },
        }]]) });
        for (const key of [1, 2] as const) {
            props.scripts[key] = { ...props.scripts[key], analysisOutdated: false, editorUpdate: { analysisAvailable: true } } as any;
        }
        return props;
    }

    it('holds the execution of a script while the agent answers its question', () => {
        const props = executableProps();
        props.generations = new Map([[1, { question: 'how many orders', status: 'dashql agent catalog', error: null, note: null }]]) as any;
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 1, style: {} } as any)} />));
        expect(container.querySelector<HTMLButtonElement>('[data-testid="script-execute"]')?.disabled).toBe(true);
        // The composer shows the status line and the stop button
        expect(container.textContent).not.toContain('dashql agent catalog');
        expect(container.querySelector('[data-testid="generation-stop"]')).toBeNull();
    });

    it('leaves the answers and errors of the agent to the composer', () => {
        const props = executableProps();
        props.generations = new Map([
            [1, { question: 'how many orders', status: null, error: null, note: 'There are 42 orders' }],
            [2, { question: 'how many customers', status: null, error: 'HTTP 500', note: null }],
        ]) as any;
        for (const index of [1, 3]) {
            act(() => root.render(<ScriptFeedRow {...({ ...props, index, style: {} } as any)} />));
            expect(container.querySelector('[role="note"]')).toBeNull();
            expect(container.querySelector('[role="alert"]')).toBeNull();
            expect(container.querySelector<HTMLButtonElement>('[data-testid="script-execute"]')?.disabled).toBe(false);
        }
    });

    it('translates a dragged card without applying dnd-kit scale distortion', () => {
        const props = baseProps();
        state.sortableTransform = { x: 0, y: 120, scaleX: 0.8, scaleY: 0.4 };
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 1, style: {} } as any)} />));

        const item = container.querySelector<HTMLElement>('[data-testid="script-feed-item"]')!;
        expect(item.style.transform).toBe('translate3d(0px, 120px, 0px)');
        expect(item.style.transform).not.toContain('scale');
    });
});

describe('Session feed composer', () => {
    const feedState = {
        keyHandlers: [] as any[],
        composerProps: null as SessionComposerProps | null,
        runSessionScript: vi.fn(),
        executeQuery: vi.fn(),
        agent: null as any,
        agentListener: null as AgentRunListener | null,
        submit: vi.fn(),
        view: null as any,
        rowProps: null as any,
    };
    // Stable like the storage contexts, the feed lists the data files again whenever the backend changes
    const storageReader = { backend: { listDataFiles: () => Promise.resolve([]) } } as any;
    const storageWriter = { write: () => Promise.resolve({ status: 'written' }) } as any;
    const feedDependencies: SessionFeedDependencies = {
        useQueryExecutor: () => feedState.executeQuery,
        useStorageReader: () => storageReader,
        useStorageWriter: () => storageWriter,
        usePickScriptConnection: () => vi.fn(),
        useAttachScriptConnection: () => vi.fn(),
        usePickDefaultConnection: () => vi.fn(),
        useAttachDefaultConnection: () => vi.fn(),
        useKeyEvents: (handlers: any[]) => { feedState.keyHandlers = handlers; },
        runSessionScript: feedState.runSessionScript as any,
        useAgentBridge: () => feedState.agent,
        SessionComposer: (props: SessionComposerProps) => {
            feedState.composerProps = props;
            if (props.submitRef) props.submitRef.current = feedState.submit;
            React.useEffect(() => props.setView?.(feedState.view), [props.setView]);
            return <div data-testid="composer" />;
        },
        ScriptFeedRow: (props: any) => {
            feedState.rowProps = props;
            return <div />;
        },
    };
    const onlineConn = {
        connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE,
        connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
        details: { type: HYPER_CONNECTOR, value: { proto: {} } },
    } as any;

    function session(fileNames: string[] = []): SessionScripts {
        const scripts: SessionScripts['scripts'] = {};
        const scriptRefs: SessionScripts['scriptRefs'] = {};
        fileNames.forEach((fileName, i) => {
            scripts[i + 1] = script(i + 1, fileName) as any;
            scriptRefs[fileName] = { scriptId: i + 1, fileName };
        });
        return {
            sessionId: 'session', name: null, connectionId: 'database', settings: { cacheQueryResults: false }, instance: {} as any, sessionMetadata: {} as any,
            connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], connectionCatalog: {} as any,
            scripts, scriptRefs, scriptOrder: [...fileNames], scriptFocus: { fileName: fileNames[fileNames.length - 1] ?? '' }, semanticUserFocus: null,
        };
    }

    function fakeView(text: string, hasFocus = true) {
        return {
            hasFocus,
            state: { doc: { toString: () => text, length: text.length } },
            dispatch: vi.fn(),
            focus: vi.fn(),
        };
    }

    let container: HTMLDivElement;
    let root: Root;
    let attention: { sessionId: string; active: boolean; request: ReturnType<typeof vi.fn> };
    beforeEach(() => {
        feedState.keyHandlers = [];
        feedState.composerProps = null;
        feedState.runSessionScript.mockReset();
        feedState.submit.mockReset();
        feedState.agent = null;
        feedState.agentListener = null;
        feedState.rowProps = null;
        feedState.view = fakeView('');
        attention = { sessionId: 'session', active: false, request: vi.fn() };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    function render(sessionScripts: SessionScripts, modifySessionScripts: any, conn: any = onlineConn) {
        act(() => root.render(<LoggerProvider>
            <SessionConnectionAttentionContext.Provider value={attention as any}>
                <SessionFeed sessionScripts={sessionScripts} modifySessionScripts={modifySessionScripts}
                    showDetails={vi.fn()} conn={conn} active={true} dependencies={feedDependencies} />
            </SessionConnectionAttentionContext.Provider>
        </LoggerProvider>));
    }

    it('greets an empty session with the hero composer', () => {
        render(session(), vi.fn());
        expect(container.querySelector('[data-testid="feed-landing-title"]')).not.toBeNull();
        expect(feedState.composerProps?.variant).toBe(SessionComposerVariant.Hero);
    });

    it('docks the composer below the scripts of a session', () => {
        render(session(['1_alpha.sql']), vi.fn());
        expect(container.querySelector('[data-testid="feed-landing-title"]')).toBeNull();
        expect(feedState.composerProps?.variant).toBe(SessionComposerVariant.Docked);
    });

    it('appends a sent draft as a script and runs it', async () => {
        const next = session(['1_alpha.sql']);
        const modify = vi.fn(() => Promise.resolve(next));
        render(session(), modify);
        await act(async () => feedState.composerProps!.onSend('select 1', ComposerInputMode.Sql));
        expect(modify).toHaveBeenCalledExactlyOnceWith({ type: CREATE_SCRIPT, value: { index: null, text: 'select 1' } });
        await vi.waitFor(() => expect(feedState.runSessionScript).toHaveBeenCalledOnce());
        expect(feedState.runSessionScript).toHaveBeenCalledExactlyOnceWith(
            next, next.scripts[1], feedState.executeQuery, modify, expect.anything());
        expect(attention.request).not.toHaveBeenCalled();
    });

    it('only creates the script without a healthy connection', async () => {
        const modify = vi.fn(() => Promise.resolve(session(['1_alpha.sql'])));
        render(session(), modify, null);
        await act(async () => feedState.composerProps!.onSend('select 1', ComposerInputMode.Sql));
        expect(modify).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(attention.request).toHaveBeenCalledExactlyOnceWith('session'));
        expect(feedState.runSessionScript).not.toHaveBeenCalled();
    });

    it('sends the draft on Ctrl+E only while the composer has focus', async () => {
        feedState.view = fakeView('select 2', false);
        render(session(['1_alpha.sql']), vi.fn());
        const handler = feedState.keyHandlers.find(h => h.key === 'e' && h.ctrlKey && h.capture);
        const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
        handler.callback(event);
        expect(event.stopPropagation).not.toHaveBeenCalled();
        expect(feedState.submit).not.toHaveBeenCalled();

        feedState.view.hasFocus = true;
        await act(async () => handler.callback(event));
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        expect(feedState.submit).toHaveBeenCalledOnce();
    });

    /// An agent bridge whose session has agent access
    function connectedAgent(request: (sessionId: string, prompt: string, listener: AgentRunListener) => Promise<string>) {
        return {
            status: AgentConnectionStatus.Connected,
            supported: true,
            port: 47100,
            hasAccess: () => true,
            setAccess: vi.fn(),
            request: vi.fn(request),
            cancel: vi.fn(() => Promise.resolve()),
            reset: vi.fn(() => Promise.resolve()),
            context: vi.fn(() => Promise.resolve({ folder: '/agent', harness: 'claude', harnessSession: null, terminalCommand: null })),
        };
    }

    it('shows the agent on top of the composer in place of the greeting', async () => {
        render(session(), vi.fn());
        expect(feedState.composerProps?.agent).toBeNull();
        expect(container.querySelector('[data-testid="feed-landing-title"]')).not.toBeNull();

        feedState.agent = { ...connectedAgent(() => Promise.resolve('run')), status: AgentConnectionStatus.Connecting };
        render(session(), vi.fn());
        expect(feedState.composerProps?.agent).toMatchObject({ connected: false, port: 47100, context: null, runs: [] });
        expect(container.querySelector('[data-testid="feed-landing-title"]')).toBeNull();

        feedState.agent = connectedAgent(() => Promise.resolve('run'));
        render(session(), vi.fn());
        expect(feedState.agent.context).toHaveBeenCalledWith('session');
        await vi.waitFor(() => expect(feedState.composerProps?.agent).toMatchObject({ connected: true, context: { harness: 'claude' } }));
        expect(container.querySelector('[data-testid="feed-landing-title"]')).toBeNull();

        feedState.agent = { ...connectedAgent(() => Promise.resolve('run')), hasAccess: () => false };
        render(session(), vi.fn());
        expect(feedState.composerProps?.agent).toBeNull();
        expect(container.querySelector('[data-testid="feed-landing-title"]')).not.toBeNull();
    });

    it('offers AI only with agent access and a connected agent server', () => {
        render(session(), vi.fn());
        expect(feedState.composerProps?.aiAvailable).toBe(false);
        feedState.agent = { ...connectedAgent(() => Promise.resolve('run')), status: AgentConnectionStatus.Connecting };
        render(session(), vi.fn());
        expect(feedState.composerProps?.aiAvailable).toBe(false);
        feedState.agent = connectedAgent(() => Promise.resolve('run'));
        render(session(), vi.fn());
        expect(feedState.composerProps?.aiAvailable).toBe(true);
    });

    // A catalog without tables, enough to build the agent prompt
    const emptyCatalog = {
        createUncachedSnapshot: () => ({
            read: () => ({
                catalogReader: { schemasLength: () => 0, tablesLength: () => 0, columnsLength: () => 0 },
                readName: () => '',
            }),
            destroy: () => { },
        }),
    };

    it('creates the script with the question as comment and runs it once the agent wrote it', async () => {
        feedState.agent = connectedAgent((_sessionId, _prompt, listener) => {
            feedState.agentListener = listener;
            return Promise.resolve('run-1');
        });
        const created = { ...session(['1_alpha.sql']), connectionCatalog: emptyCatalog as any };
        const modify = vi.fn((_action: any) => Promise.resolve(created));
        render({ ...session(), connectionCatalog: emptyCatalog as any }, modify);

        await act(async () => feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai));
        expect(modify).toHaveBeenCalledExactlyOnceWith({ type: CREATE_SCRIPT, value: { index: null, text: '-- how many rows' } });
        expect(feedState.agent.request).toHaveBeenCalledOnce();
        const [sessionId, prompt] = feedState.agent.request.mock.calls[0];
        expect(sessionId).toBe('session');
        expect(prompt).toContain('in the DashQL script 1_alpha.');
        expect(prompt).toContain('The connection speaks Tableau Hyper (PostgreSQL-compatible).');
        expect(prompt.endsWith('Question:\nhow many rows')).toBe(true);

        render(created, modify);
        const waiting = { question: 'how many rows', status: 'waiting for agent...', error: null, note: null };
        expect(feedState.rowProps.generations.get(1)).toEqual(waiting);
        expect(feedState.composerProps?.agent?.runs).toEqual([{ scriptKey: 1, scriptName: '1_alpha', generation: waiting }]);
        await act(async () => feedState.agentListener!.status('running', 'dashql agent catalog'));
        expect(feedState.composerProps?.agent?.runs[0].generation.status).toBe('dashql agent catalog');
        await act(async () => feedState.agentListener!.done('There are 3 rows', [1]));
        const answered = { question: 'how many rows', status: null, error: null, note: 'There are 3 rows' };
        expect(feedState.rowProps.generations.get(1)).toEqual(answered);
        expect(feedState.composerProps?.agent?.runs).toEqual([{ scriptKey: 1, scriptName: '1_alpha', generation: answered }]);
        await act(async () => feedState.composerProps!.agent!.onDismiss(1));
        expect(feedState.composerProps?.agent?.runs).toEqual([]);
        expect(feedState.runSessionScript).toHaveBeenCalledExactlyOnceWith(created, created.scripts[1], feedState.executeQuery, modify, expect.anything());
    });

    it('does not rerun a script that the agent ran itself', async () => {
        feedState.agent = connectedAgent((_sessionId, _prompt, listener) => {
            feedState.agentListener = listener;
            return Promise.resolve('run-1');
        });
        const created = { ...session(['1_alpha.sql']), connectionCatalog: emptyCatalog as any };
        const modify = vi.fn(() => Promise.resolve(created));
        render({ ...session(), connectionCatalog: emptyCatalog as any }, modify);
        await act(async () => feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai));
        render(created, modify);
        await act(async () => feedState.agentListener!.done('', []));
        expect(feedState.rowProps.generations.size).toBe(0);
        expect(feedState.runSessionScript).not.toHaveBeenCalled();
    });

    it('stops the agent', async () => {
        feedState.agent = connectedAgent((_sessionId, _prompt, listener) => {
            feedState.agentListener = listener;
            return Promise.resolve('run-1');
        });
        const created = { ...session(['1_alpha.sql']), connectionCatalog: emptyCatalog as any };
        const modify = vi.fn(() => Promise.resolve(created));
        render({ ...session(), connectionCatalog: emptyCatalog as any }, modify);
        await act(async () => feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai));
        render(created, modify);
        await act(async () => feedState.composerProps!.agent!.onStop(1));
        expect(feedState.agent.cancel).toHaveBeenCalledExactlyOnceWith('session');
        await act(async () => feedState.agentListener!.failed('Stopped', true));
        expect(feedState.rowProps.generations.size).toBe(0);
    });

    it('replaces the text of a script with a snippet, as a diff if the script has text', async () => {
        const modify = vi.fn(() => Promise.resolve(session(['1_alpha.sql'])));
        const current = session(['1_alpha.sql', '2_beta.sql']);
        current.scripts[2] = { ...current.scripts[2], scriptSession: { getText: () => '  \n' } } as any;
        render(current, modify);
        expect(feedState.rowProps).not.toBeNull();
        await act(async () => feedState.rowProps.onApplySnippet(1, 'select 2;'));
        expect(modify).toHaveBeenLastCalledWith({ type: SET_SCRIPT_TEXT, value: { scriptKey: 1, text: 'select 2;', withDiff: true } });
        await act(async () => feedState.rowProps.onApplySnippet(2, 'select 3;'));
        expect(modify).toHaveBeenLastCalledWith({ type: SET_SCRIPT_TEXT, value: { scriptKey: 2, text: 'select 3;', withDiff: false } });
    });

    it('keeps the commented script when the agent fails', async () => {
        feedState.agent = connectedAgent(() => Promise.reject(new Error('The agent server is not connected')));
        const created = { ...session(['1_alpha.sql']), connectionCatalog: emptyCatalog as any };
        const modify = vi.fn(() => Promise.resolve(created));
        render({ ...session(), connectionCatalog: emptyCatalog as any }, modify);
        await act(async () => feedState.composerProps!.onSend('anything', ComposerInputMode.Ai));
        await act(async () => { });
        render(created, modify);
        expect(modify).toHaveBeenCalledOnce();
        expect(feedState.rowProps.generations.get(1)?.error).toBe('The agent server is not connected');
        expect(feedState.composerProps?.agent?.runs[0].generation.error).toBe('The agent server is not connected');
        expect(feedState.runSessionScript).not.toHaveBeenCalled();
    });
});
