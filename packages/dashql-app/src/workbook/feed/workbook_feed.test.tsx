import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as dashql from '@akohn/dashql';
import { ScriptFeedRow, type ScriptFeedRowDependencies } from './workbook_feed_row.js';
import type { ScriptCardProps } from './script_card.js';
import { fakeScript, fakeScriptModel } from '@akohn/dashql-react/testing/fake_models';
import type { ScriptModel } from '@akohn/dashql-react/models/script_model';
import { ResizeObserverMock } from '@akohn/dashql-react/testing/resize_observer_mock';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { WorkbookConnectionAttentionContext } from '../connections/workbook_connection_attention.js';

type Attention = NonNullable<React.ContextType<typeof WorkbookConnectionAttentionContext>>;
import { WorkbookReadOnlyContext } from '../workbook_read_only.js';
import { WorkbookDataCard, type WorkbookDataCardProps } from './workbook_data_card.js';
import { LoggerProvider } from '../../host/logger_provider.js';
import { HostProvider, type DownloadFile } from '@akohn/dashql-react/host';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { WorkbookFeed, type WorkbookFeedDependencies } from './workbook_feed.js';
import { WorkbookComposerVariant, type WorkbookComposerProps } from './workbook_composer.js';
import type { AgentSession, AgentSessionArgs, AgentTurn } from '../../agent/agent_session.js';
import { ComposerMode } from '../../agent/agent_connect.js';
import type { AgentConnect } from '../../agent/agent_session_provider.js';
import type { ModifyWorkbookScripts, ScriptData, ScriptDataMap, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { EditorView } from '@codemirror/view';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = { sortableTransform: null as { x: number; y: number; scaleX: number; scaleY: number } | null, scripts: {} as { [key: number]: ScriptData } };
const scriptModels = new WeakMap<ScriptData, ScriptModel>();
// The row connects a card, the tests of the card are in script_card.test.tsx
const dependencies: ScriptFeedRowDependencies = {
    // A fake model of each script of the row, one per script, the scripts come from the props of the row
    useScriptModel: (workbookId: string, scriptKey: number | null | undefined) => {
        const script = scriptKey == null ? undefined : state.scripts[scriptKey];
        if (script == null) return null;
        let model = scriptModels.get(script);
        if (model == null) {
            model = fakeScriptModel({ workbookId, script });
            scriptModels.set(script, model);
        }
        return model;
    },
    useSortable: () => ({
        attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: state.sortableTransform, transition: undefined, isDragging: false,
    }),
    translateTransform: (transform: { x: number; y: number } | null) => transform == null
        ? undefined
        : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    ScriptCard: (props: ScriptCardProps) => <article data-testid="script-cell" data-script={props.model.script.fileName} />,
} as unknown as ScriptFeedRowDependencies;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

function baseProps() {
    const scripts = { 1: fakeScript(1, '01_alpha.sql'), 2: fakeScript(2, '02_beta.sql') } as { [key: number]: ScriptData };
    return {
        workbookId: 'workbook', connections: new Map(),
        storageReader: { backend: {}, getWorkbookLocation: () => ({ type: 'opfs' }) },
        entries: [{ scriptId: 1, fileName: '01_alpha.sql' }, { scriptId: 2, fileName: '02_beta.sql' }],
        scripts, scriptDebugMode: false, formattingDebugMode: false,
        keywordCase: dashql.buffers.formatting.KeywordCase.UPPER,
        focusedFileName: '01_alpha.sql', active: true, canTarget: true, collapsedResults: new Map(),
        fold: { toggle: vi.fn(), autoCollapse: vi.fn(), resetAutoCollapsed: vi.fn() },
        feed: {
            create: vi.fn(), focus: vi.fn(), delete: vi.fn(), rename: vi.fn(), pickConnection: vi.fn(), moveUp: vi.fn(),
            moveDown: vi.fn(), target: vi.fn(), editorView: vi.fn(),
        },
        onRowHeightChange: vi.fn(), dependencies,
    };
}

/// Render a row of the feed over fake models of its scripts
function renderRow(root: Root, props: ReturnType<typeof baseProps>, wrap: (row: React.ReactElement) => React.ReactElement = row => row) {
    state.scripts = props.scripts;
    act(() => root.render(wrap(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as unknown as React.ComponentProps<typeof ScriptFeedRow>)} />)));
}

describe('V2 workbook feed rows', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => { state.sortableTransform = null; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    it('disables every file action for non-WASM connections', () => {
        const workbookId = '12345678-1234-1234-1234-123456789abc';
        const props: WorkbookDataCardProps = {
            workbookId, attachment: { fileName: 'sales 2.parquet', name: 'sales 2', sizeBytes: 42 },
            conn: null, storageReader: { backend: new WorkbookTestBackend() } as unknown as WorkbookDataCardProps['storageReader'], onRemoved: vi.fn(),
        };
        for (const conn of [null,
            { connectorType: ConnectorType.HYPER, details: { setupParams: { protocol: 'V3_HTTP' }, channel: null, connector: { kind: 'hyper' } } },
            { connectorType: ConnectorType.TRINO, details: { setupParams: null, channel: null, connector: { kind: 'trino' } } },
        ]) {
            act(() => root.render(<LoggerProvider>
                <WorkbookDataCard {...props} conn={conn as unknown as WorkbookDataCardProps['conn']} />
            </LoggerProvider>));
            expect(container.textContent).toContain('sales 2.parquet');
            expect(container.querySelector('[data-testid="data-file-type"]')?.textContent).toContain('PARQUET');
            for (const action of ['data-file-download', 'data-file-remove']) {
                expect(container.querySelector<HTMLButtonElement>(`[data-testid="${action}"]`)?.disabled).toBe(true);
            }
            // The tag of the table parameter is disabled like the tag of a script
            expect(container.querySelector('[data-testid="script-mention"]')?.getAttribute('aria-disabled')).toBe('true');
            expect(Array.from(container.querySelectorAll('button')).filter(button => button.dataset.testid !== 'script-mention')
                .every(button => button.disabled)).toBe(true);
            expect(container.querySelector('[data-testid="script-drag-handle"]')).toBeNull();
        }
    });

    it('mentions and renames the table parameter of a Parquet attachment and flags a script of the same name', async () => {
        const onMention = vi.fn();
        const onRename = vi.fn();
        const wasm = { connectorType: ConnectorType.HYPER, readsAttachments: true, details: { setupParams: { protocol: 'WASM' }, channel: null, connector: { kind: 'hyper' } } } as unknown as WorkbookDataCardProps['conn'];
        act(() => root.render(<LoggerProvider>
            <WorkbookDataCard workbookId="workbook" attachment={{ fileName: 'sales.parquet', name: 'sales', sizeBytes: 3 }} conn={wasm}
                storageReader={{ backend: new WorkbookTestBackend() } as unknown as WorkbookDataCardProps['storageReader']} onRemoved={vi.fn()} onMention={onMention} onRename={onRename} collides />
        </LoggerProvider>));
        const tag = container.querySelector<HTMLButtonElement>('[data-testid="script-mention"]')!;
        expect(tag.textContent).toBe(':sales');
        expect(container.querySelector('[data-testid="data-file-collision"]')).not.toBeNull();
        act(() => tag.click());
        expect(onMention).toHaveBeenCalledExactlyOnceWith('sales');
        // The pencil turns the tag into the input of the name, like the tag of a script
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="data-file-rename"]')!.click());
        const input = container.querySelector<HTMLInputElement>('[data-testid="script-name-input"]')!;
        expect(input.getAttribute('aria-label')).toBe('Rename sales attachment');
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'revenue');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(onRename).toHaveBeenCalledExactlyOnceWith('revenue');
    });

    it('downloads data bytes and removes the file before requesting a list refresh for HyperDB WASM', async () => {
        const backend = new WorkbookTestBackend();
        const bytes = new Uint8Array([0, 255, 13]);
        await backend.saveDataFile('workbook', 'sales.parquet', bytes);
        const onRemoved = vi.fn();
        const download = vi.fn<DownloadFile>().mockResolvedValue();
        try {
            act(() => root.render(<LoggerProvider>
                <HostProvider value={{ setupCore: null, downloadFile: download }}>
                    <WorkbookDataCard workbookId="workbook" attachment={{ fileName: 'sales.parquet', name: 'sales', sizeBytes: 3 }}
                        conn={{ connectorType: ConnectorType.HYPER, readsAttachments: true, details: { setupParams: { protocol: 'WASM' }, channel: null, connector: { kind: 'hyper' } } } as unknown as WorkbookDataCardProps['conn']}
                        storageReader={{ backend } as unknown as WorkbookDataCardProps['storageReader']} onRemoved={onRemoved} />
                </HostProvider>
            </LoggerProvider>));
            const downloadButton = container.querySelector<HTMLButtonElement>('[data-testid="data-file-download"]');
            expect(downloadButton).not.toBeNull();
            expect(Array.from(container.querySelectorAll('button')).every(button => !button.disabled)).toBe(true);
            await act(async () => { downloadButton!.click(); });
            expect(download).toHaveBeenCalledExactlyOnceWith(bytes, 'sales.parquet');
            await vi.waitFor(() => expect(container.querySelector<HTMLButtonElement>('[data-testid="data-file-remove"]')!.disabled).toBe(false));
            await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="data-file-remove"]')!.click(); });
            expect(await backend.listDataFiles('workbook')).toEqual([]);
            expect(onRemoved).toHaveBeenCalledExactlyOnceWith();
        } finally {
            download.mockRestore();
        }
    });

    it('adds scripts above and below a script without separator rows', () => {
        const props = baseProps();
        renderRow(root, props);
        // The first row holds the space above the feed
        expect(container.querySelector<HTMLDivElement>('[data-testid="script-feed-row"]')!.style.paddingTop).toBe('32px');
        expect(container.querySelector('[data-testid="script-cell"]')?.getAttribute('data-script')).toBe('01_alpha.sql');
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="script-insert-above"]')!.click());
        expect(props.feed.create).toHaveBeenLastCalledWith(0);
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="script-insert-below"]')!.click());
        expect(props.feed.create).toHaveBeenLastCalledWith(1);
    });

    it('adds and moves no scripts of a read-only workbook', () => {
        renderRow(root, baseProps(), row => <WorkbookReadOnlyContext.Provider value={true}>{row}</WorkbookReadOnlyContext.Provider>);
        expect(container.querySelector('[data-testid="script-cell"]')).not.toBeNull();
        for (const action of ['script-insert-above', 'script-insert-below', 'script-drag-handle']) {
            expect(container.querySelector(`[data-testid="${action}"]`), action).toBeNull();
        }
    });

    /// The size observers report when the test asks them to, a browser reports a new observer once before the paint
    function withResizeObserverMock(test: () => void) {
        const resizeObserver = globalThis.ResizeObserver;
        ResizeObserverMock.reset();
        globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
        try {
            test();
        } finally {
            globalThis.ResizeObserver = resizeObserver;
        }
    }

    it('measures a row when its size observer reports, the editor of a mounted row does not exist before', () => {
        withResizeObserverMock(() => {
            const props = baseProps();
            const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 312 } as DOMRect);
            try {
                renderRow(root, props);
                expect(container.querySelector<HTMLElement>('[data-testid="script-feed-row"]')!.style.height).toBe('');
                expect(props.onRowHeightChange).not.toHaveBeenCalled();
                ResizeObserverMock.instances[ResizeObserverMock.instances.length - 1].trigger();
                expect(props.onRowHeightChange).toHaveBeenCalledExactlyOnceWith(0, 312);
            } finally {
                rect.mockRestore();
            }
        });
    });

    it('measures a row again when an inserted script takes its index at the same size', () => {
        withResizeObserverMock(() => {
            const props = baseProps();
            const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 120 } as DOMRect);
            try {
                renderRow(root, props);
                ResizeObserverMock.instances[ResizeObserverMock.instances.length - 1].trigger();
                expect(props.onRowHeightChange).toHaveBeenCalledExactlyOnceWith(0, 120);
                props.onRowHeightChange.mockClear();
                const observers = ResizeObserverMock.instances.length;
                // A script inserted above takes the mounted row of index 0, a new size observer reports the same size
                const inserted = { ...props, entries: [{ scriptId: 3, fileName: '03_gamma.sql' }, ...props.entries],
                    scripts: { ...props.scripts, 3: fakeScript(3, '03_gamma.sql') } };
                renderRow(root, inserted);
                expect(ResizeObserverMock.instances.length).toBe(observers + 1);
                ResizeObserverMock.instances[ResizeObserverMock.instances.length - 1].trigger();
                expect(props.onRowHeightChange).toHaveBeenCalledExactlyOnceWith(0, 120);
            } finally {
                rect.mockRestore();
            }
        });
    });

    it('translates a dragged card without applying dnd-kit scale distortion', () => {
        const props = baseProps();
        state.sortableTransform = { x: 0, y: 120, scaleX: 0.8, scaleY: 0.4 };
        renderRow(root, props);

        const item = container.querySelector<HTMLElement>('[data-testid="script-feed-item"]')!;
        expect(item.style.transform).toBe('translate3d(0px, 120px, 0px)');
        expect(item.style.transform).not.toContain('scale');
    });
});

describe('Workbook feed composer', () => {
    /// The props of a row of the feed
    type RowProps = React.ComponentProps<WorkbookFeedDependencies['ScriptFeedRow']>;
    const feedState = {
        keyHandlers: [] as Parameters<WorkbookFeedDependencies['useKeyEvents']>[0],
        composerProps: null as WorkbookComposerProps | null,
        /// The props of the bar of Wobble above the composer, null while the feed shows none
        barProps: null as React.ComponentProps<WorkbookFeedDependencies['WorkbookStatusBar']> | null,
        /// The bar that rendered the props last
        barOwner: null as object | null,
        runScript: vi.fn(),
        /// The scripts of the workbook that the feed shows, and the workbook that the runtime holds after an action
        scripts: {} as ScriptDataMap,
        next: null as (WorkbookScripts & { scripts: ScriptDataMap }) | null,
        /// The session of an agent in the terminal that the feed gets, and what the feed gave it
        session: null as AgentSession | null,
        connect: null as AgentConnect | null,
        sessionArgs: null as AgentSessionArgs | null,
        submit: vi.fn(),
        view: null as ReturnType<typeof fakeView> | null,
        rowProps: null as RowProps | null,
        /// The heights of the text and the results of the scripts that the rows lay out
        rowLayouts: new Map<number, { text: number; result: number }>(),
    };
    // Stable like the storage contexts
    const storageReader = { backend: {} } as unknown as ReturnType<WorkbookFeedDependencies['useStorageReader']>;
    const attachmentCommands = {
        attachFiles: vi.fn(async (_workbookId: string, files: readonly { name: string }[]) => ({ attached: files.map(file => ({ name: file.name, fileName: file.name })), refused: [] as string[] })),
        refreshAttachments: vi.fn(async () => {}),
    };
    const feedDependencies: WorkbookFeedDependencies = {
        useStorageReader: () => storageReader,
        useAttachmentCommands: () => attachmentCommands,
        usePickScriptConnection: () => vi.fn(),
        usePickPendingConnection: () => vi.fn(),
        useKeyEvents: handlers => { feedState.keyHandlers = handlers; },
        useScriptRun: () => feedState.runScript,
        useWorkbookScriptMap: () => feedState.scripts,
        useWorkbookDerived: () => null,
        useLiveScriptReader: () => (key: number) => feedState.next?.scripts[key] ?? null,
        useComposerCore: () => ({ instance: {}, catalog: {}, tableParameters: { attach: () => false }, connectorType: ConnectorType.HYPER }) as unknown as ReturnType<WorkbookFeedDependencies['useComposerCore']>,
        useAgentSession: (args: AgentSessionArgs) => { feedState.sessionArgs = args; return feedState.session; },
        useAgentConnect: () => feedState.connect,
        WorkbookComposer: (props: WorkbookComposerProps) => {
            feedState.composerProps = props;
            if (props.submitRef) props.submitRef.current = feedState.submit;
            const { setView } = props;
            // The composer reads the text, the focus and the dispatch of the view
            React.useEffect(() => setView?.(feedState.view as unknown as EditorView | null), [setView]);
            return <div data-testid="composer">{props.bar}</div>;
        },
        WorkbookStatusBar: (props) => {
            // A new composer mounts its bar before the old one unmounts, only the latest bar clears the props
            const owner = React.useRef({});
            feedState.barProps = props;
            feedState.barOwner = owner.current;
            React.useEffect(() => () => {
                if (feedState.barOwner === owner.current) feedState.barProps = null;
            }, []);
            return <div data-testid="workbook-status-bar" />;
        },
        ScriptFeedRow: (props: RowProps) => {
            feedState.rowProps = props;
            const entry = props.entries[props.index];
            const layout = entry != null ? feedState.rowLayouts.get(entry.scriptId) : undefined;
            if (layout == null) return <div />;
            return (
                <div style={props.style}>
                    <div data-script-key={entry.scriptId}>
                        <div style={{ height: layout.text }} />
                        <div data-feed-result="" style={{ height: layout.result }} />
                    </div>
                </div>
            );
        },
    };
    const onlineConn = {
        connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE,
        connectorType: ConnectorType.HYPER, label: { name: 'Hyper', connector: 'Hyper', detail: 'Wasm', text: 'Hyper Wasm' },
        details: { setupParams: null, channel: null, connector: { kind: 'hyper' } },
    } as unknown as ConnectionState;

    /// A workbook of scripts on the connection `database`, with its scripts by key
    function workbook(fileNames: string[] = []): WorkbookScripts & { scripts: ScriptDataMap } {
        const scripts: ScriptDataMap = {};
        const scriptRefs: WorkbookScripts['scriptRefs'] = {};
        fileNames.forEach((fileName, i) => {
            scripts[i + 1] = fakeScript(i + 1, fileName);
            scriptRefs[fileName] = { scriptId: i + 1, fileName };
        });
        return {
            workbookId: 'workbook', name: null, workbookMetadata: {}, pendingConnectionId: 'database', nextScriptConnectionId: 'database',
            scriptKeys: fileNames.map((_, i) => i + 1), scriptConnections: fileNames.map(() => 'database'), connectionIds: ['database'],
            scripts, scriptRefs, scriptOrder: [...fileNames],
        } as unknown as WorkbookScripts & { scripts: ScriptDataMap };
    }
    /// Every action of the feed applies
    const APPLIED = { ok: true, changed: true, error: null, id: null };

    /// The workbook with a catalog for the composer, the composer drafts the next script on the pending connection
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
    // The attention of the connections that the tests read, its request is a mock
    let attention: Attention & { request: Mock<Attention['request']> };
    beforeEach(() => {
        feedState.keyHandlers = [];
        feedState.composerProps = null;
        feedState.barProps = null;
        feedState.runScript.mockReset();
        feedState.submit.mockReset();
        feedState.session = null;
        feedState.connect = null;
        feedState.sessionArgs = null;
        feedState.rowProps = null;
        feedState.rowLayouts.clear();
        feedState.scripts = {};
        feedState.next = null;
        feedState.view = fakeView('');
        attention = { active: false, request: vi.fn<Attention['request']>() };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    function render(workbookScripts: WorkbookScripts & { scripts: ScriptDataMap }, modifyWorkbookScripts: ModifyWorkbookScripts, conn: ConnectionState | null = onlineConn, scriptConnections?: Map<string, ConnectionState>) {
        feedState.scripts = workbookScripts.scripts;
        act(() => root.render(<LoggerProvider>
            <WorkbookConnectionAttentionContext.Provider value={attention}>
                <WorkbookFeed workbookScripts={workbookScripts} modifyWorkbookScripts={modifyWorkbookScripts}
                    conn={conn} scriptConnections={scriptConnections} active={true} dependencies={feedDependencies} />
            </WorkbookConnectionAttentionContext.Provider>
        </LoggerProvider>));
    }

    /// The session of Claude Code in the terminal with its questions
    function agentSession(turns: AgentTurn[] = []): AgentSession {
        return { id: 's1', harness: 'claude', folder: '/agent', connected: true, ended: false, turns, onDismiss: vi.fn(), onShowScript: vi.fn() };
    }
    /// A question that the agent works on
    const question = (questionId: number, status: string | null = 'Edit scripts/1_alpha.sql'): AgentTurn => ({
        questionId,
        question: { question: 'how many rows', status, waiting: null, interrupted: false, note: null, steps: [] },
        scripts: [],
    });

    it('greets an empty workbook with the hero composer', () => {
        render(workbook(), vi.fn());
        expect(container.querySelector('[data-testid="feed-landing-question"]')).not.toBeNull();
        expect(feedState.composerProps?.variant).toBe(WorkbookComposerVariant.Hero);
    });

    it('docks the composer below the scripts of a workbook', () => {
        render(workbook(['1_alpha.sql']), vi.fn());
        expect(container.querySelector('[data-testid="feed-landing-question"]')).toBeNull();
        expect(feedState.composerProps?.variant).toBe(WorkbookComposerVariant.Docked);
    });

    it('appends a sent draft as a script and runs it', async () => {
        const next = workbook(['1_alpha.sql']);
        feedState.next = next;
        const modify = vi.fn(() => ({ ...APPLIED, id: 1 }));
        render(workbook(), modify);
        await act(async () => feedState.composerProps!.onSend('select 1'));
        expect(modify).toHaveBeenCalledExactlyOnceWith({ kind: 'createScript', value: expect.objectContaining({ text: 'select 1' }) });
        await vi.waitFor(() => expect(feedState.runScript).toHaveBeenCalledOnce());
        expect(feedState.runScript).toHaveBeenCalledExactlyOnceWith(next.workbookId, next.scripts[1].scriptKey);
        expect(attention.request).not.toHaveBeenCalled();
    });

    it('keeps the composer draft while the connection of the next script is not connected', () => {
        render(workbook(), vi.fn());
        expect(feedState.composerProps?.offlineWorkbookId).toBeNull();
        render(workbook(), vi.fn(), { ...onlineConn, connectionHealth: ConnectionHealth.NOT_STARTED });
        expect(feedState.composerProps?.offlineWorkbookId).toBe('workbook');
    });

    it('only creates the script without a healthy connection', async () => {
        feedState.next = workbook(['1_alpha.sql']);
        const modify = vi.fn(() => ({ ...APPLIED, id: 1 }));
        render(workbook(), modify, null);
        await act(async () => feedState.composerProps!.onSend('select 1'));
        expect(modify).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(attention.request).toHaveBeenCalledExactlyOnceWith());
        expect(feedState.runScript).not.toHaveBeenCalled();
    });

    it('sends the draft on Ctrl+E only while the composer has focus', async () => {
        feedState.view = fakeView('select 2', false);
        render(workbook(['1_alpha.sql']), vi.fn());
        const handler = feedState.keyHandlers.find(h => h.key === 'e' && h.ctrlKey && h.capture)!;
        const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
        handler.callback(event as unknown as KeyboardEvent);
        expect(event.stopPropagation).not.toHaveBeenCalled();
        expect(feedState.submit).not.toHaveBeenCalled();

        feedState.view!.hasFocus = true;
        await act(async () => handler.callback(event as unknown as KeyboardEvent));
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        expect(feedState.submit).toHaveBeenCalledOnce();
    });

    it('passes the session of an agent in the terminal to the bar and closes the prompt', async () => {
        render(workbook(), vi.fn());
        expect(feedState.barProps).toMatchObject({ workbookId: 'workbook', variant: 'prompt', session: null });
        expect(feedState.composerProps?.session).toBeNull();

        // An empty workbook greets until the agent works on a question, then the composer docks
        feedState.session = agentSession();
        render(workbook(), vi.fn());
        expect(container.querySelector('[data-testid="feed-landing-question"]')).not.toBeNull();
        expect(feedState.composerProps?.session).toBe(feedState.session);
        feedState.session = agentSession([question(1)]);
        render(workbook(), vi.fn());
        expect(container.querySelector('[data-testid="feed-landing-question"]')).toBeNull();
        expect(feedState.composerProps?.variant).toBe(WorkbookComposerVariant.Docked);
        expect(feedState.composerProps?.agentWorking).toBe(true);
        expect(feedState.barProps?.session).toBe(feedState.session);
    });

    it('greets an empty workbook again once the prompt switches back to SQL', () => {
        feedState.session = agentSession([question(1, null)]);
        feedState.connect = { mode: ComposerMode.Ai } as AgentConnect;
        render(workbook(), vi.fn());
        expect(container.querySelector('[data-testid="feed-landing-question"]')).toBeNull();
        expect(feedState.composerProps?.variant).toBe(WorkbookComposerVariant.Docked);

        // The tab still follows the session with its questions
        feedState.connect = { mode: ComposerMode.Sql } as AgentConnect;
        render(workbook(), vi.fn());
        expect(container.querySelector('[data-testid="feed-landing-question"]')).not.toBeNull();
        expect(feedState.composerProps?.variant).toBe(WorkbookComposerVariant.Hero);
        expect(feedState.barProps?.session).toBe(feedState.session);
    });

    it('shows a script that the user picks in the log of the agent', async () => {
        const scrollTo = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(() => { });
        const clientHeight = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(100);
        try {
            feedState.session = agentSession();
            render(workbook(['1_alpha.sql', '2_beta.sql', '3_gamma.sql']), vi.fn());
            scrollTo.mockClear();
            await act(async () => feedState.sessionArgs!.showScript(3));
            expect(scrollTo).toHaveBeenCalledOnce();
        } finally {
            scrollTo.mockRestore();
            clientHeight.mockRestore();
        }
    });

    it('follows the agent to the scripts it edits and runs until the user takes over the feed', async () => {
        feedState.session = agentSession([question(1)]);
        // A short viewport that keeps the scripts apart, scrolling moves it
        const clientHeight = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(100);
        const scrollTo = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(function (this: Element, options?: ScrollToOptions | number) {
            const top = typeof options === 'object' ? options.top ?? 0 : 0;
            Object.defineProperty(this, 'scrollTop', { value: top, configurable: true });
        });
        try {
            render(workbook(['1_alpha.sql', '2_beta.sql', '3_gamma.sql']), vi.fn());
            scrollTo.mockClear();

            // An edit below the viewport scrolls to the script, a script in view stays where it is
            await act(async () => feedState.sessionArgs!.followScript(3, 'script'));
            expect(scrollTo).toHaveBeenCalledOnce();
            const scrolled = (scrollTo.mock.calls[0][0] as ScrollToOptions).top!;
            expect(scrolled).toBeGreaterThan(0);
            await act(async () => feedState.sessionArgs!.followScript(3, 'script'));
            expect(scrollTo).toHaveBeenCalledOnce();

            // A run of another script while the agent still works scrolls back to it.
            // The first script scrolls to the top of the feed, with the add button above it.
            await act(async () => feedState.sessionArgs!.followScript(1, 'result'));
            expect(scrollTo).toHaveBeenCalledTimes(2);
            expect(scrolled).toBeGreaterThan(0);
            expect((scrollTo.mock.calls[1][0] as ScrollToOptions).top!).toBe(0);

            // Once the user scrolls the feed, the agent's edits stay where they are
            act(() => container.querySelector('[data-testid="feed-list"]')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
            await act(async () => feedState.sessionArgs!.followScript(3, 'script'));
            expect(scrollTo).toHaveBeenCalledTimes(2);

            // The next question in the terminal follows the agent again
            feedState.session = agentSession([question(1, null), question(2)]);
            render(workbook(['1_alpha.sql', '2_beta.sql', '3_gamma.sql']), vi.fn());
            await act(async () => feedState.sessionArgs!.followScript(3, 'script'));
            expect(scrollTo).toHaveBeenCalledTimes(3);
        } finally {
            scrollTo.mockRestore();
            clientHeight.mockRestore();
        }
    });

    it('keeps the rows in view in place when a row above the viewport changes its height', () => {
        render(workbook(['1_alpha.sql', '2_beta.sql', '3_gamma.sql']), vi.fn());
        for (let i = 0; i < 3; ++i) act(() => feedState.rowProps!.onRowHeightChange(i, 200));
        const list = container.querySelector<HTMLElement>('[data-testid="feed-list"] [role="list"]')!;
        // Scrolled into the second script
        Object.defineProperty(list, 'scrollTop', { value: 300, writable: true, configurable: true });

        act(() => feedState.rowProps!.onRowHeightChange(0, 285));
        expect(list.scrollTop).toBe(385);

        // The script at the top of the viewport and the script below it move only the rows below them
        act(() => feedState.rowProps!.onRowHeightChange(1, 300));
        act(() => feedState.rowProps!.onRowHeightChange(2, 300));
        expect(list.scrollTop).toBe(385);
    });

    it('scrolls to a script that the insert button creates between two scripts', async () => {
        const clientHeight = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(100);
        const scrollTo = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(function (this: Element, options?: ScrollToOptions | number) {
            const top = typeof options === 'object' ? options.top ?? 0 : 0;
            Object.defineProperty(this, 'scrollTop', { value: top, configurable: true });
        });
        try {
            const before = workbook(['1_alpha.sql', '2_beta.sql', '3_gamma.sql']);
            // The created script lands between the second and the third script and takes the focus
            const created = workbook(['1_alpha.sql', '2_beta.sql', '3_gamma.sql', '4_delta.sql']);
            created.scriptOrder = ['1_alpha.sql', '2_beta.sql', '4_delta.sql', '3_gamma.sql'];
            feedState.next = created;
            const modify = vi.fn(() => ({ ...APPLIED, id: 4 }));
            render(before, modify);
            for (let i = 0; i < 3; ++i) act(() => feedState.rowProps!.onRowHeightChange(i, 200));
            scrollTo.mockClear();

            act(() => feedState.rowProps!.feed.create(2));
            expect(modify).toHaveBeenCalledExactlyOnceWith({ kind: 'createScript', value: expect.objectContaining({ index: 2 }) });
            render(created, modify);
            await vi.waitFor(() => expect(scrollTo).toHaveBeenCalled());
            expect((scrollTo.mock.lastCall![0] as ScrollToOptions).top!).toBeGreaterThan(0);
        } finally {
            scrollTo.mockRestore();
            clientHeight.mockRestore();
        }
    });

    it('keeps the mounted rows of the scripts below a script that is inserted above them', () => {
        const clientHeight = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(1000);
        try {
            // A row remembers the script that it mounted with
            const ScriptFeedRow = (props: RowProps) => {
                const [mountedScriptId] = React.useState(() => props.entries[props.index]?.scriptId);
                return <div style={props.style} data-testid="row" data-script-key={props.entries[props.index]?.scriptId}
                    data-mounted-script-key={mountedScriptId} />;
            };
            const renderFeed = (workbookScripts: WorkbookScripts & { scripts: ScriptDataMap }) => act(() => root.render(<LoggerProvider>
                <WorkbookConnectionAttentionContext.Provider value={attention}>
                    <WorkbookFeed workbookScripts={workbookScripts} modifyWorkbookScripts={vi.fn()} conn={onlineConn}
                        active={true} dependencies={{ ...feedDependencies, ScriptFeedRow }} />
                </WorkbookConnectionAttentionContext.Provider>
            </LoggerProvider>));
            const rows = () => Array.from(container.querySelectorAll<HTMLElement>('[data-testid="row"]'))
                .map(row => [row.dataset.scriptKey, row.dataset.mountedScriptKey]);
            renderFeed(workbook(['1_alpha.sql', '2_beta.sql']));
            expect(rows()).toEqual([['1', '1'], ['2', '2']]);

            // The created script lands above the first script, the rows of the first and the second script move down
            const created = workbook(['1_alpha.sql', '2_beta.sql', '3_gamma.sql']);
            created.scriptOrder = ['3_gamma.sql', '1_alpha.sql', '2_beta.sql'];
            renderFeed(created);
            expect(rows()).toEqual([['3', '3'], ['1', '1'], ['2', '2']]);
        } finally {
            clientHeight.mockRestore();
        }
    });

    it('follows the agent to the results of a script it runs', async () => {
        feedState.session = agentSession([question(1)]);
        feedState.rowLayouts.set(2, { text: 250, result: 150 });
        const clientHeight = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(100);
        const scrollTo = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(function (this: Element, options?: ScrollToOptions | number) {
            const top = typeof options === 'object' ? options.top ?? 0 : 0;
            Object.defineProperty(this, 'scrollTop', { value: top, configurable: true });
        });
        const lastTop = () => (scrollTo.mock.lastCall?.[0] as ScrollToOptions | undefined)?.top;
        try {
            render(workbook(['1_alpha.sql', '2_beta.sql']), vi.fn());
            act(() => feedState.rowProps!.onRowHeightChange(0, 400));
            act(() => feedState.rowProps!.onRowHeightChange(1, 400));

            // An edit shows the text of a script taller than the viewport, below the first script and the gap
            await act(async () => feedState.sessionArgs!.followScript(2, 'script'));
            await vi.waitFor(() => expect(lastTop()).toBe(32 + 400 + 32 - 16));
            // A run shows its results
            await act(async () => feedState.sessionArgs!.followScript(2, 'result'));
            await vi.waitFor(() => expect(lastTop()).toBe(32 + 400 + 32 + 250 - 16));
        } finally {
            scrollTo.mockRestore();
            clientHeight.mockRestore();
        }
    });

    it('leaves Enter and Escape to an open modal dialog instead of a staged rewrite', () => {
        const modify = vi.fn(() => APPLIED);
        const current = workbook(['1_alpha.sql']);
        current.scripts[1] = { ...current.scripts[1], pendingDiff: { priorText: '', diffBuffer: {} } } as unknown as ScriptData;
        render(current, modify);
        const press = (key: string) => {
            const event = new KeyboardEvent('keydown', { key, cancelable: true });
            feedState.keyHandlers.filter(handler => handler.key === key).forEach(handler => handler.callback(event));
            return event.defaultPrevented;
        };

        // The chart builder stages its diff while it is open, Escape closes the builder
        const dialog = document.createElement('section');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        document.body.appendChild(dialog);
        try {
            expect(press('Escape')).toBe(false);
            expect(press('Enter')).toBe(false);
            expect(modify).not.toHaveBeenCalled();
        } finally {
            dialog.remove();
        }

        // Without the dialog, Escape rejects the staged rewrite
        expect(press('Escape')).toBe(true);
        expect(modify).toHaveBeenLastCalledWith({ kind: 'rejectPendingDiff', value: { scriptKey: 1 } });
    });

});
