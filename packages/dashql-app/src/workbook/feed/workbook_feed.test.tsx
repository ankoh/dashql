import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dashql from '@akohn/dashql';
import { ScriptFeedRow, type ScriptFeedRowDependencies } from './workbook_feed_row.js';
import { ResizeObserverMock } from '../../tests/mocks/view_mocks.js';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { WorkbookConnectionAttentionContext } from '../workbook_connection_attention.js';
import { WorkbookReadOnlyContext } from '../workbook_read_only.js';
import { WorkbookDataCard, type WorkbookDataCardProps } from './workbook_data_card.js';
import { LoggerProvider } from '../../platform/logger_provider.js';
import { WebFileDownloader } from '../../platform/file/web_file_downloader.js';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { WorkbookFeed, type WorkbookFeedDependencies } from './workbook_feed.js';
import { WorkbookComposerVariant, type WorkbookComposerProps } from './workbook_composer.js';
import type { AgentSession, AgentSessionArgs, AgentTurn } from '../../agent/agent_session.js';
import { ComposerMode } from '../../agent/agent_connect.js';
import type { AgentConnect } from '../../agent/agent_session_provider.js';
import type { ScriptDataMap, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { CONNECTOR_INFOS } from '@akohn/dashql/platform/connections/connector_info';
import { EntryStatusBar } from '../entry_status_bar.js';
import { CachedResultBean } from '../persistence/query_result_cache_controls.js';
import { FeedEntryTabStrip } from './feed_entry_footer.js';

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
        useQuery: () => state.query,
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
        QueryResultRerunButton: () => null,
        EntryStatusBar: (props: any) => <button data-testid="status" onClick={props.onToggleExpanded}>{props.status.message}</button>,
        FeedEntryFooter: (props: any) => <button data-testid="integrated-footer" onClick={props.onShowTable}>footer</button>,
        FeedEntryTabStrip: () => null,
        ResultTableOverlay: (props: any) => (
            <div data-testid="result-table-overlay" data-script={props.scriptName} data-query={props.query.queryId}>
                <button data-testid="result-table-overlay-close" onClick={props.onClose} />
            </div>
        ),
    },
} as unknown as ScriptFeedRowDependencies;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

function baseProps() {
    return {
        workbookId: 'workbook', connections: new Map(),
        storageReader: { backend: {}, getWorkbookLocation: () => ({ type: 'opfs' }) },
        entries: [{ scriptId: 1, fileName: '01_alpha.sql' }, { scriptId: 2, fileName: '02_beta.sql' }],
        scripts: { 1: script(1, '01_alpha.sql'), 2: script(2, '02_beta.sql') }, scriptDebugMode: false, formattingDebugMode: false,
        keywordCase: dashql.buffers.formatting.KeywordCase.UPPER,
        focusedFileName: '01_alpha.sql', active: true, onFocus: vi.fn(), onDelete: vi.fn(),
        onRename: vi.fn(), onPickConnection: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), onExecute: vi.fn(), onRerun: vi.fn(),
        onFormat: vi.fn(), onApplySnippet: vi.fn(), onSetVisSpec: vi.fn(), canTarget: true, onTarget: vi.fn(), onAcceptDiff: vi.fn(), onRejectDiff: vi.fn(), collapsedResults: new Map(), onToggleResultExpanded: vi.fn(),
        onAutoCollapseResult: vi.fn(), onResetAutoCollapsedResult: vi.fn(),
        onCreate: vi.fn(), onEditorView: vi.fn(), onRowHeightChange: vi.fn(), dependencies,
    };
}

function script(scriptKey: number, fileName: string) {
    return { scriptKey, fileName, scriptSession: { getText: () => 'SELECT 1' }, analysisOutdated: true,
        annotations: {}, statistics: [], pendingDiff: null, latestQueryId: null, connectionId: 'database' };
}

describe('V2 workbook feed rows', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => { state.query = null; state.sortableTransform = null; state.formatScriptEditor.mockReset(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    it('disables every file action for non-WASM connections', () => {
        const workbookId = '12345678-1234-1234-1234-123456789abc';
        const props: WorkbookDataCardProps = {
            workbookId, attachment: { fileName: 'sales 2.parquet', name: 'sales 2', sizeBytes: 42 },
            conn: null, storageReader: { backend: new WorkbookTestBackend() } as any, onRemoved: vi.fn(),
        };
        for (const conn of [null,
            { connectorType: ConnectorType.HYPER, details: { setupParams: { protocol: 'V3_HTTP' }, channel: null, connector: { kind: 'hyper' } } },
            { connectorType: ConnectorType.TRINO, details: { setupParams: null, channel: null, connector: { kind: 'trino' } } },
        ]) {
            act(() => root.render(<LoggerProvider>
                <WorkbookDataCard {...props} conn={conn as any} />
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
        const wasm = { connectorType: ConnectorType.HYPER, readsAttachments: true, details: { setupParams: { protocol: 'WASM' }, channel: null, connector: { kind: 'hyper' } } } as any;
        act(() => root.render(<LoggerProvider>
            <WorkbookDataCard workbookId="workbook" attachment={{ fileName: 'sales.parquet', name: 'sales', sizeBytes: 3 }} conn={wasm}
                storageReader={{ backend: new WorkbookTestBackend() } as any} onRemoved={vi.fn()} onMention={onMention} onRename={onRename} collides />
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
        const download = vi.spyOn(WebFileDownloader.prototype, 'downloadBufferAsFile').mockResolvedValue();
        try {
            act(() => root.render(<LoggerProvider>
                <WorkbookDataCard workbookId="workbook" attachment={{ fileName: 'sales.parquet', name: 'sales', sizeBytes: 3 }}
                    conn={{ connectorType: ConnectorType.HYPER, readsAttachments: true, details: { setupParams: { protocol: 'WASM' }, channel: null, connector: { kind: 'hyper' } } } as any}
                    storageReader={{ backend } as any} onRemoved={onRemoved} />
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
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
        // The first row holds the space above the feed
        expect(container.querySelector<HTMLDivElement>('[data-testid="script-feed-row"]')!.style.paddingTop).toBe('32px');
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="script-insert-above"]')!.click());
        expect(props.onCreate).toHaveBeenLastCalledWith(0);
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="script-insert-below"]')!.click());
        expect(props.onCreate).toHaveBeenLastCalledWith(1);
    });

    it('shows the scripts of a read-only workbook greyed out, without what runs or changes them', () => {
        const props = baseProps();
        act(() => root.render(<WorkbookReadOnlyContext.Provider value={true}>
            <ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />
        </WorkbookReadOnlyContext.Provider>));
        expect(container.querySelector('[data-testid="script-cell"]')!.hasAttribute('data-read-only')).toBe(true);
        expect(container.querySelector('[data-testid="script-read-only"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="editor"]')).not.toBeNull();
        for (const action of ['script-execute', 'script-delete', 'script-chart', 'script-snippets', 'script-more-actions',
            'script-move-up', 'script-move-down', 'script-insert-above', 'script-insert-below', 'script-drag-handle']) {
            expect(container.querySelector(`[data-testid="${action}"]`), action).toBeNull();
        }
    });

    it('marks a result that was loaded from the cache as cached in the status bar', async () => {
        const props = baseProps();
        // The runtime looked up the cached result of the script
        props.scripts[1] = { ...props.scripts[1], latestQueryId: 42, analysisOutdated: false, cachedResult: { key: 'key', cachedAt: Date.now() - 8 * 60_000 } } as any;
        Object.assign(props, {
            connections: new Map([['database', {
                connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE, details: { setupParams: null, channel: null, connector: { kind: 'trino' } },
                connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], label: 'Trino', labelParts: { name: 'Trino', detail: '' },
            }]]),
            dependencies: { ...dependencies, scriptCard: { ...dependencies.scriptCard, EntryStatusBar, CachedResultBean, FeedEntryTabStrip } },
        });
        state.query = { queryId: 42, traceId: 9, status: 9, resultTable: {}, servedFromCache: true };
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
        expect(container.textContent).toContain('Result loaded from cache');
        await vi.waitFor(() => expect(container.querySelector('[data-testid="cached-result"]')).not.toBeNull());

        // Clicking the tag tells since when the result is cached
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="cached-result"]')!.click());
        expect(document.querySelector('[data-testid="cached-result-detail"]')?.textContent).toContain('8 minutes ago');
    });

    it('focuses on pointer entry and exposes integrated execution footer', () => {
        const props = baseProps();
        props.scripts[1] = { ...props.scripts[1], latestQueryId: 42 } as any;
        // The script runs on Trino, its rows format in the dialect of Trino
        Object.assign(props, { connections: new Map([['database', {
            connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE, details: { setupParams: null, channel: null, connector: { kind: 'trino' } },
            connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], label: 'Trino', labelParts: { name: 'Trino', detail: '' },
        }]]) });
        state.query = { queryId: 42, traceId: 9, status: 9, resultTable: {} };
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
        const article = container.querySelector('[data-testid="script-cell"]')!;
        act(() => article.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
        expect(props.onFocus).toHaveBeenCalledWith('01_alpha.sql');
        expect(container.querySelector('[data-testid="status"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="integrated-footer"]')).not.toBeNull();
        // The script details are gone, the full result table opens in an overlay over the feed
        expect(container.querySelector('[data-testid="script-expand"]')).toBeNull();
        expect(container.querySelector('[data-testid="result-table-overlay"]')).toBeNull();
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="integrated-footer"]')!.click());
        const overlay = container.querySelector('[data-testid="result-table-overlay"]');
        expect(overlay?.getAttribute('data-script')).toBe('01_alpha');
        expect(overlay?.getAttribute('data-query')).toBe('42');
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="result-table-overlay-close"]')!.click());
        expect(container.querySelector('[data-testid="result-table-overlay"]')).toBeNull();
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
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="diff-accept"]')!.click());
        expect(props.onAcceptDiff).toHaveBeenCalledWith(1);
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="diff-reject"]')!.click());
        expect(props.onRejectDiff).toHaveBeenCalledWith(1);
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
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
        const snippets = container.querySelector<HTMLButtonElement>('[data-testid="script-snippets"]')!;
        expect(snippets.disabled).toBe(false);
        const deleteButton = container.querySelector('[data-testid="script-delete"]')!;
        expect(snippets.compareDocumentPosition(deleteButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        props.scripts[1] = { ...props.scripts[1], pendingDiff: {} } as any;
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
        expect(container.querySelector<HTMLButtonElement>('[data-testid="script-snippets"]')!.disabled).toBe(true);
    });

    it('shows the connection instead of the file name and edits the file in the storage view', () => {
        const props = baseProps();
        Object.assign(props, { connections: new Map([['database', {
            connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE, details: { setupParams: null, channel: null, connector: { kind: 'trino' } }, connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO],
            label: 'Trino Http', labelParts: { name: 'Trino', detail: 'Http' },
        }]]) });
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
        // The connection takes the place of the file name
        const picker = container.querySelector('[data-testid="script-connection-picker"]')!;
        expect(picker.textContent).toContain('Trino');
        // The header shows the logo of the database, neither the protocol nor the health
        expect(picker.textContent).not.toContain('Http');
        expect(picker.querySelector('use')?.getAttribute('xlink:href')).toContain(CONNECTOR_INFOS[ConnectorType.TRINO].icons.colored);
        expect(picker.textContent).not.toContain('01_alpha');

        act(() => (container.querySelector('[data-testid="script-more-actions"]') as HTMLButtonElement).click());
        act(() => document.querySelector<HTMLButtonElement>('[data-testid="script-menu-item"][data-action="storage"]')!.click());
        const storage = document.querySelector('[data-testid="script-storage"]')!;
        expect(storage.textContent).toContain('opfs://workbooks/workbook/scripts/01_alpha.sql');
        const input = storage.querySelector<HTMLInputElement>('[data-testid="script-file-name-input"]')!;
        expect(input.value).toBe('01_alpha.sql');
        input.value = 'report';
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(props.onRename).toHaveBeenCalledExactlyOnceWith('01_alpha.sql', 'report');
    });

    it('mentions the script with a tag that shows its current name', () => {
        const props = baseProps();
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
        const mention = container.querySelector<HTMLButtonElement>('[data-testid="script-mention"]')!;
        expect(mention.textContent).toBe(':01_alpha');
        act(() => mention.click());
        expect(props.onTarget).toHaveBeenCalledWith('01_alpha.sql');

        // A rename shows the new name right away
        props.entries[0] = { scriptId: 1, fileName: 'report.sql' };
        props.scripts[1] = script(1, 'report.sql');
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
        expect(container.querySelector('[data-testid="script-mention"]')!.textContent).toBe(':report');
    });

    it('renames the script in the tag from the action menu', async () => {
        const props = baseProps();
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
        const setInputValue = (input: HTMLInputElement, value: string) => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve(null)));
        // Rename in the action menu edits the name in the tag, the header has no rename button
        const rename = () => {
            act(() => (container.querySelector('[data-testid="script-more-actions"]') as HTMLButtonElement).click());
            act(() => document.querySelector<HTMLButtonElement>('[data-testid="script-menu-item"][data-action="rename"]')!.click());
        };
        expect(container.querySelector('[data-testid="script-rename"]')).toBeNull();
        // A double click on the tag mentions the script twice and edits nothing
        const mention = container.querySelector<HTMLButtonElement>('[data-testid="script-mention"]')!;
        act(() => {
            mention.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
            mention.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
            mention.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
        });
        expect(props.onTarget).toHaveBeenCalledTimes(2);
        expect(container.querySelector('[data-testid="script-name-input"]')).toBeNull();

        // The input keeps the focus after the menu closes
        rename();
        let input = container.querySelector<HTMLInputElement>('[data-testid="script-name-input"]')!;
        expect(input.value).toBe('01_alpha');
        await act(nextFrame);
        expect(document.activeElement).toBe(input);
        act(() => setInputValue(input, 'report'));
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(props.onRename).toHaveBeenCalledWith('01_alpha.sql', 'report');
        expect(container.querySelector('[data-testid="script-name-input"]')).toBeNull();

        // Escape abandons the edit
        rename();
        input = container.querySelector<HTMLInputElement>('[data-testid="script-name-input"]')!;
        act(() => setInputValue(input, 'other'));
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(props.onRename).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="script-mention"]')!.textContent).toBe(':01_alpha');
    });

    it('keeps Play available for SQL with parser diagnostics', () => {
        const props = baseProps();
        Object.assign(props, { connections: new Map([['database', {
            connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE, details: { setupParams: null, channel: null, connector: { kind: 'trino' } }, connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], label: 'Trino Http',
            labelParts: { name: 'Trino', detail: 'Http' },
        }]]) });
        props.scripts[1] = { ...props.scripts[1], analysisOutdated: false,
            editorUpdate: { analysisAvailable: true }, scriptSession: { getText: () => 'SELECT * FROM t QUALIFY x = 1' } } as any;
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));

        const play = container.querySelector('[data-testid="script-execute"]') as HTMLButtonElement;
        expect(play.disabled).toBe(false);
        act(() => play.click());
        expect(props.onExecute).toHaveBeenCalledWith('01_alpha.sql');
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
                act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
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
                act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
                ResizeObserverMock.instances[ResizeObserverMock.instances.length - 1].trigger();
                expect(props.onRowHeightChange).toHaveBeenCalledExactlyOnceWith(0, 120);
                props.onRowHeightChange.mockClear();
                const observers = ResizeObserverMock.instances.length;
                // A script inserted above takes the mounted row of index 0, a new size observer reports the same size
                const inserted = { ...props, entries: [{ scriptId: 3, fileName: '03_gamma.sql' }, ...props.entries],
                    scripts: { ...props.scripts, 3: script(3, '03_gamma.sql') } };
                act(() => root.render(<ScriptFeedRow {...({ ...inserted, index: 0, style: {} } as any)} />));
                expect(ResizeObserverMock.instances.length).toBe(observers + 1);
                ResizeObserverMock.instances[ResizeObserverMock.instances.length - 1].trigger();
                expect(props.onRowHeightChange).toHaveBeenCalledExactlyOnceWith(0, 120);
            } finally {
                rect.mockRestore();
            }
        });
    });

    it('greys the play button offline and requests attention once per pointer entry without opening settings', () => {
        const props = baseProps();
        const request = vi.fn();
        act(() => root.render(<WorkbookConnectionAttentionContext.Provider value={{ workbookId: 'workbook', active: false, request }}>
            <ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />
        </WorkbookConnectionAttentionContext.Provider>));
        const play = container.querySelector<HTMLButtonElement>('[data-testid="script-execute"]')!;
        // The button stays a greyed play button that does not run the script
        expect(play.disabled).toBe(false);
        expect(play.getAttribute('aria-label')).toMatch(/^Execute /);
        expect(props.onExecute).not.toHaveBeenCalled();
        const wrapper = container.querySelector<HTMLElement>('[data-execution-connection-blocked="true"]')!;
        expect(wrapper.contains(play)).toBe(true);
        act(() => {
            wrapper.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
            wrapper.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: play }));
            wrapper.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
        });
        expect(request).toHaveBeenCalledExactlyOnceWith('workbook');
        expect(wrapper.tabIndex).toBe(0);
        // A click pulses the connections as well, it opens nothing
        act(() => play.click());
        expect(request).toHaveBeenCalledTimes(2);
        expect(props.onExecute).not.toHaveBeenCalled();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('translates a dragged card without applying dnd-kit scale distortion', () => {
        const props = baseProps();
        state.sortableTransform = { x: 0, y: 120, scaleX: 0.8, scaleY: 0.4 };
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));

        const item = container.querySelector<HTMLElement>('[data-testid="script-feed-item"]')!;
        expect(item.style.transform).toBe('translate3d(0px, 120px, 0px)');
        expect(item.style.transform).not.toContain('scale');
    });
});

describe('Workbook feed composer', () => {
    const feedState = {
        keyHandlers: [] as any[],
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
        view: null as any,
        rowProps: null as any,
        /// The heights of the text and the results of the scripts that the rows lay out
        rowLayouts: new Map<number, { text: number; result: number }>(),
    };
    // Stable like the storage contexts
    const storageReader = { backend: {} } as any;
    const attachmentCommands = {
        attachFiles: vi.fn(async (_workbookId: string, files: readonly { name: string }[]) => ({ attached: files.map(file => ({ name: file.name, fileName: file.name })), refused: [] as string[] })),
        refreshAttachments: vi.fn(async () => {}),
    };
    const feedDependencies: WorkbookFeedDependencies = {
        useStorageReader: () => storageReader,
        useAttachmentCommands: () => attachmentCommands,
        usePickScriptConnection: () => vi.fn(),
        usePickPendingConnection: () => vi.fn(),
        useKeyEvents: (handlers: any[]) => { feedState.keyHandlers = handlers; },
        useScriptRun: () => feedState.runScript,
        useWorkbookScriptMap: () => feedState.scripts,
        useWorkbookDerived: () => null,
        useLiveWorkbookReader: () => () => feedState.next,
        useLiveScriptReader: () => (key: number) => feedState.next?.scripts[key] ?? null,
        useComposerCore: () => ({ instance: {} as any, catalog: {} as any, tableParameters: { attach: () => false }, connectorType: ConnectorType.HYPER }),
        useAgentSession: (args: AgentSessionArgs) => { feedState.sessionArgs = args; return feedState.session; },
        useAgentConnect: () => feedState.connect,
        WorkbookComposer: (props: WorkbookComposerProps) => {
            feedState.composerProps = props;
            if (props.submitRef) props.submitRef.current = feedState.submit;
            React.useEffect(() => props.setView?.(feedState.view), [props.setView]);
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
        ScriptFeedRow: (props: any) => {
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
        connectorType: ConnectorType.HYPER,
        details: { setupParams: null, channel: null, connector: { kind: 'hyper' } },
    } as any;

    /// A workbook of scripts on the connection `database`, with its scripts by key
    function workbook(fileNames: string[] = []): WorkbookScripts & { scripts: ScriptDataMap } {
        const scripts: ScriptDataMap = {};
        const scriptRefs: WorkbookScripts['scriptRefs'] = {};
        fileNames.forEach((fileName, i) => {
            scripts[i + 1] = script(i + 1, fileName) as any;
            scriptRefs[fileName] = { scriptId: i + 1, fileName };
        });
        return {
            workbookId: 'workbook', name: null, workbookMetadata: {} as any, pendingConnectionId: 'database', nextScriptConnectionId: 'database',
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
    let attention: { workbookId: string; active: boolean; request: ReturnType<typeof vi.fn> };
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
        attention = { workbookId: 'workbook', active: false, request: vi.fn() };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    function render(workbookScripts: WorkbookScripts & { scripts: ScriptDataMap }, modifyWorkbookScripts: any, conn: any = onlineConn, scriptConnections?: Map<string, any>) {
        feedState.scripts = workbookScripts.scripts;
        act(() => root.render(<LoggerProvider>
            <WorkbookConnectionAttentionContext.Provider value={attention as any}>
                <WorkbookFeed workbookScripts={workbookScripts} modifyWorkbookScripts={modifyWorkbookScripts}
                    conn={conn} scriptConnections={scriptConnections} active={true} dependencies={feedDependencies} />
            </WorkbookConnectionAttentionContext.Provider>
        </LoggerProvider>));
    }

    /// The session of Claude Code in the terminal with its questions
    function agentSession(turns: AgentTurn[] = []): AgentSession {
        return { harness: 'claude', folder: '/agent', connected: true, turns, onDismiss: vi.fn(), onShowScript: vi.fn() };
    }
    /// A question that the agent works on
    const question = (questionId: number, status: string | null = 'Edit scripts/1_alpha.sql'): AgentTurn => ({
        questionId,
        question: { question: 'how many rows', status, error: null, note: null, steps: [] },
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
        const modify = vi.fn(() => APPLIED);
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
        const modify = vi.fn(() => APPLIED);
        render(workbook(), modify, null);
        await act(async () => feedState.composerProps!.onSend('select 1'));
        expect(modify).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(attention.request).toHaveBeenCalledExactlyOnceWith('workbook'));
        expect(feedState.runScript).not.toHaveBeenCalled();
    });

    it('sends the draft on Ctrl+E only while the composer has focus', async () => {
        feedState.view = fakeView('select 2', false);
        render(workbook(['1_alpha.sql']), vi.fn());
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
        for (let i = 0; i < 3; ++i) act(() => feedState.rowProps.onRowHeightChange(i, 200));
        const list = container.querySelector<HTMLElement>('[data-testid="feed-list"] [role="list"]')!;
        // Scrolled into the second script
        Object.defineProperty(list, 'scrollTop', { value: 300, writable: true, configurable: true });

        act(() => feedState.rowProps.onRowHeightChange(0, 285));
        expect(list.scrollTop).toBe(385);

        // The script at the top of the viewport and the script below it move only the rows below them
        act(() => feedState.rowProps.onRowHeightChange(1, 300));
        act(() => feedState.rowProps.onRowHeightChange(2, 300));
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
            const modify = vi.fn(() => APPLIED);
            render(before, modify);
            for (let i = 0; i < 3; ++i) act(() => feedState.rowProps.onRowHeightChange(i, 200));
            scrollTo.mockClear();

            act(() => feedState.rowProps.onCreate(2));
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
            const ScriptFeedRow = (props: any) => {
                const [mountedScriptId] = React.useState(() => props.entries[props.index]?.scriptId);
                return <div style={props.style} data-testid="row" data-script-key={props.entries[props.index]?.scriptId}
                    data-mounted-script-key={mountedScriptId} />;
            };
            const renderFeed = (workbookScripts: WorkbookScripts & { scripts: ScriptDataMap }) => act(() => root.render(<LoggerProvider>
                <WorkbookConnectionAttentionContext.Provider value={attention as any}>
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
            act(() => feedState.rowProps.onRowHeightChange(0, 400));
            act(() => feedState.rowProps.onRowHeightChange(1, 400));

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

    it('replaces the text of a script with a snippet, as a diff if the script has text', async () => {
        const modify = vi.fn(() => APPLIED);
        const current = workbook(['1_alpha.sql', '2_beta.sql']);
        current.scripts[2] = { ...current.scripts[2], scriptSession: { getText: () => '  \n' } } as any;
        render(current, modify);
        expect(feedState.rowProps).not.toBeNull();
        await act(async () => feedState.rowProps.onApplySnippet(1, 'select 2;'));
        expect(modify).toHaveBeenLastCalledWith({ kind: 'setScriptText', value: { scriptKey: 1, text: 'select 2;', withDiff: true } });
        await act(async () => feedState.rowProps.onApplySnippet(2, 'select 3;'));
        expect(modify).toHaveBeenLastCalledWith({ kind: 'setScriptText', value: { scriptKey: 2, text: 'select 3;', withDiff: false } });
    });

    it('leaves Enter and Escape to an open modal dialog instead of a staged rewrite', () => {
        const modify = vi.fn(() => APPLIED);
        const current = workbook(['1_alpha.sql']);
        current.scripts[1] = { ...current.scripts[1], pendingDiff: { priorText: '', diffBuffer: {} } } as any;
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
