import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dashql from '@ankoh/dashql-core';
import { ScriptFeedRow, type ScriptFeedRowDependencies } from './session_feed_row.js';
import { ConnectorType } from '../../connections/connector_info.js';
import { ConnectionHealth } from '../../connections/connection_state.js';
import { SessionConnectionAttentionContext } from '../session_connection_attention.js';
import { SessionDataCard, type SessionDataCardProps } from './session_data_card.js';
import { HYPER_CONNECTOR, TRINO_CONNECTOR } from '../../connections/connector_info.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { WebFileDownloader } from '../../platform/file/web_file_downloader.js';
import { SessionTestBackend } from '../../storage/session_test_backend.js';
import { SessionFeed, type SessionFeedDependencies } from './session_feed.js';
import { SessionComposerVariant, type SessionComposerProps } from './session_composer.js';
import { ComposerInputMode } from '../../agent/input_mode.js';
import type { AgentTurnListener } from '../../agent/agent_bridge.js';
import { AgentQuestionStore } from '../../agent/agent_question_store.js';
import { AgentConnectionStatus } from '../../agent/agent_client.js';
import { CREATE_SCRIPT, REJECT_PENDING_DIFF, SET_SCRIPT_TEXT, type SessionScripts } from '../scripts/session_scripts.js';
import { CONNECTOR_INFOS } from '../../connections/connector_info.js';
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
        useQueryState: () => state.query,
        useCancelQuery: () => vi.fn(),
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
        sessionId: 'session', connections: new Map(), computeCacheKey: vi.fn(async () => null),
        storageReader: { backend: {}, getSessionLocation: () => ({ type: 'opfs' }) },
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
        annotations: {}, statistics: [], completion: null, pendingDiff: null, latestQueryId: null,
        connection: { connectionId: 'database', connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], catalog: {} } };
}

describe('V2 session feed rows', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => { state.query = null; state.sortableTransform = null; state.formatScriptEditor.mockReset(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    it('disables every file action for non-WASM connections', () => {
        const sessionId = '12345678-1234-1234-1234-123456789abc';
        const props: SessionDataCardProps = {
            sessionId, file: { name: 'sales 2.parquet', sizeBytes: 42 },
            conn: null, storageReader: { backend: new SessionTestBackend() } as any, onRemoved: vi.fn(),
        };
        for (const conn of [null,
            { details: { type: HYPER_CONNECTOR, value: { proto: { setupParams: { protocol: 'V3_HTTP' } } } } },
            { details: { type: TRINO_CONNECTOR, value: {} } },
        ]) {
            act(() => root.render(<LoggerProvider>
                <SessionDataCard {...props} conn={conn as any} />
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
        const wasm = { details: { type: HYPER_CONNECTOR, value: { proto: { setupParams: { protocol: 'WASM' } } } } } as any;
        act(() => root.render(<LoggerProvider>
            <SessionDataCard sessionId="session" file={{ name: 'sales.parquet', sizeBytes: 3 }} conn={wasm}
                storageReader={{ backend: new SessionTestBackend() } as any} onRemoved={vi.fn()} onMention={onMention} onRename={onRename} collides />
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
        const backend = new SessionTestBackend();
        const bytes = new Uint8Array([0, 255, 13]);
        await backend.saveDataFile('session', 'sales.parquet', bytes);
        const onRemoved = vi.fn();
        const download = vi.spyOn(WebFileDownloader.prototype, 'downloadBufferAsFile').mockResolvedValue();
        try {
            act(() => root.render(<LoggerProvider>
                <SessionDataCard sessionId="session" file={{ name: 'sales.parquet', sizeBytes: 3 }}
                    conn={{ details: { type: HYPER_CONNECTOR, value: { proto: { setupParams: { protocol: 'WASM' } } } } } as any}
                    storageReader={{ backend } as any} onRemoved={onRemoved} />
            </LoggerProvider>));
            const downloadButton = container.querySelector<HTMLButtonElement>('[data-testid="data-file-download"]');
            expect(downloadButton).not.toBeNull();
            expect(Array.from(container.querySelectorAll('button')).every(button => !button.disabled)).toBe(true);
            await act(async () => { downloadButton!.click(); });
            expect(download).toHaveBeenCalledExactlyOnceWith(bytes, 'sales.parquet');
            await vi.waitFor(() => expect(container.querySelector<HTMLButtonElement>('[data-testid="data-file-remove"]')!.disabled).toBe(false));
            await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="data-file-remove"]')!.click(); });
            expect(await backend.listDataFiles('session')).toEqual([]);
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

    it('marks a result that was loaded from the cache as cached in the status bar', async () => {
        const props = baseProps();
        props.scripts[1] = { ...props.scripts[1], latestQueryId: 42, analysisOutdated: false } as any;
        Object.assign(props, {
            connections: new Map([['database', {
                connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE, details: { type: TRINO_CONNECTOR, value: {} },
                connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], label: 'Trino', labelParts: { name: 'Trino', detail: '' },
            }]]),
            computeCacheKey: vi.fn(async () => 'key'),
            lookupCachedResult: vi.fn(async () => Date.now() - 8 * 60_000),
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
            connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE, details: null, connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO],
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
        expect(storage.textContent).toContain('opfs://sessions/session/scripts/01_alpha.sql');
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
            connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE, details: null, connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], label: 'Trino Http',
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

    it('lets the virtual list observe the row content height', () => {
        const props = baseProps();
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 312 } as DOMRect);
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
        expect(container.querySelector<HTMLElement>('[data-testid="script-feed-row"]')!.style.height).toBe('');
        expect(props.onRowHeightChange).toHaveBeenCalledWith(0, 312);
        rect.mockRestore();
    });

    it('measures a row again when an inserted script takes its index at the same size', () => {
        const props = baseProps();
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 120 } as DOMRect);
        try {
            act(() => root.render(<ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />));
            expect(props.onRowHeightChange).toHaveBeenCalledExactlyOnceWith(0, 120);
            props.onRowHeightChange.mockClear();
            // A script inserted above takes the mounted row of index 0, the size observer sees no change
            const inserted = { ...props, entries: [{ scriptId: 3, fileName: '03_gamma.sql' }, ...props.entries],
                scripts: { ...props.scripts, 3: script(3, '03_gamma.sql') } };
            act(() => root.render(<ScriptFeedRow {...({ ...inserted, index: 0, style: {} } as any)} />));
            expect(props.onRowHeightChange).toHaveBeenCalledExactlyOnceWith(0, 120);
        } finally {
            rect.mockRestore();
        }
    });

    it('greys the play button offline and requests attention once per pointer entry without opening settings', () => {
        const props = baseProps();
        const request = vi.fn();
        act(() => root.render(<SessionConnectionAttentionContext.Provider value={{ sessionId: 'session', active: false, request }}>
            <ScriptFeedRow {...({ ...props, index: 0, style: {} } as any)} />
        </SessionConnectionAttentionContext.Provider>));
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
        expect(request).toHaveBeenCalledExactlyOnceWith('session');
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

describe('Session feed composer', () => {
    const feedState = {
        keyHandlers: [] as any[],
        composerProps: null as SessionComposerProps | null,
        runSessionScript: vi.fn(),
        executeQuery: vi.fn(),
        agent: null as any,
        agentListener: null as AgentTurnListener | null,
        submit: vi.fn(),
        view: null as any,
        rowProps: null as any,
        /// The heights of the text and the results of the scripts that the rows lay out
        rowLayouts: new Map<number, { text: number; result: number }>(),
    };
    // Stable like the storage contexts, the feed lists the data files again whenever the backend changes
    const storageReader = { backend: { listDataFiles: () => Promise.resolve([]) } } as any;
    const storageWriter = { write: () => Promise.resolve({ status: 'written' }) } as any;
    const feedDependencies: SessionFeedDependencies = {
        useQueryExecutor: () => feedState.executeQuery,
        useStorageReader: () => storageReader,
        useStorageWriter: () => storageWriter,
        usePickScriptConnection: () => vi.fn(),
        usePickPendingConnection: () => vi.fn(),
        useAttachPendingConnection: () => vi.fn(),
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
            sessionId: 'session', name: null, instance: {} as any, sessionMetadata: {} as any,
            pendingConnection: { connectionId: 'database', connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: {} as any },
            scripts, scriptRefs, scriptOrder: [...fileNames], scriptFocus: { fileName: fileNames[fileNames.length - 1] ?? '' }, semanticUserFocus: null,
        };
    }

    /// The session with a catalog for the composer, the composer drafts the next script on the pending connection
    function withCatalog(current: SessionScripts, catalog: unknown): SessionScripts {
        return { ...current, pendingConnection: { ...current.pendingConnection!, catalog: catalog as any } };
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
        feedState.rowLayouts.clear();
        feedState.view = fakeView('');
        attention = { sessionId: 'session', active: false, request: vi.fn() };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    function render(sessionScripts: SessionScripts, modifySessionScripts: any, conn: any = onlineConn, scriptConnections?: Map<string, any>) {
        act(() => root.render(<LoggerProvider>
            <SessionConnectionAttentionContext.Provider value={attention as any}>
                <SessionFeed sessionScripts={sessionScripts} modifySessionScripts={modifySessionScripts}
                    conn={conn} scriptConnections={scriptConnections} active={true} dependencies={feedDependencies} />
            </SessionConnectionAttentionContext.Provider>
        </LoggerProvider>));
    }

    it('greets an empty session with the hero composer', () => {
        render(session(), vi.fn());
        expect(container.querySelector('[data-testid="feed-landing-question"]')).not.toBeNull();
        expect(feedState.composerProps?.variant).toBe(SessionComposerVariant.Hero);
    });

    it('docks the composer below the scripts of a session', () => {
        render(session(['1_alpha.sql']), vi.fn());
        expect(container.querySelector('[data-testid="feed-landing-question"]')).toBeNull();
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

    it('keeps the composer draft while the connection of the next script is not connected', () => {
        render(session(), vi.fn());
        expect(feedState.composerProps?.offlineSessionId).toBeNull();
        render(session(), vi.fn(), { ...onlineConn, connectionHealth: ConnectionHealth.NOT_STARTED });
        expect(feedState.composerProps?.offlineSessionId).toBe('session');
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
    function connectedAgent(request: (sessionId: string, prompt: string, listener: AgentTurnListener) => Promise<string>) {
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
            questions: new AgentQuestionStore(),
        };
    }

    it('shows the agent on top of the composer below the greeting', async () => {
        render(session(), vi.fn());
        expect(feedState.composerProps?.agent).toBeNull();
        expect(container.querySelector('[data-testid="feed-landing-question"]')).not.toBeNull();

        feedState.agent = { ...connectedAgent(() => Promise.resolve('turn')), status: AgentConnectionStatus.Connecting };
        render(session(), vi.fn());
        expect(feedState.composerProps?.agent).toMatchObject({ connected: false, port: 47100, context: null, turns: [] });
        expect(container.querySelector('[data-testid="feed-landing-question"]')).not.toBeNull();

        feedState.agent = connectedAgent(() => Promise.resolve('turn'));
        render(session(), vi.fn());
        expect(feedState.agent.context).toHaveBeenCalledWith('session');
        await vi.waitFor(() => expect(feedState.composerProps?.agent).toMatchObject({ connected: true, context: { harness: 'claude' } }));
        expect(container.querySelector('[data-testid="feed-landing-question"]')).not.toBeNull();

        feedState.agent = { ...connectedAgent(() => Promise.resolve('turn')), hasAccess: () => false };
        render(session(), vi.fn());
        expect(feedState.composerProps?.agent).toBeNull();
        expect(container.querySelector('[data-testid="feed-landing-question"]')).not.toBeNull();
    });

    it('keeps the greeting hidden while the composer shows an agent turn', async () => {
        feedState.agent = connectedAgent(() => new Promise<string>(() => {}));
        render(withCatalog(session(), emptyCatalog), vi.fn());
        const title = () => container.querySelector('[data-testid="feed-landing-question"]')!.parentElement!;
        expect(title().hasAttribute('data-hidden')).toBe(false);

        // The waiting turn hides the greeting
        await act(async () => {
            void feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai);
        });
        expect(feedState.composerProps?.agent?.turns).toHaveLength(1);
        expect(title().hasAttribute('data-hidden')).toBe(true);

        await act(async () => feedState.composerProps!.agent!.onDismiss(1));
        expect(title().hasAttribute('data-hidden')).toBe(false);
    });

    it('offers AI only with agent access and a connected agent server', () => {
        render(session(), vi.fn());
        expect(feedState.composerProps?.aiAvailable).toBe(false);
        feedState.agent = { ...connectedAgent(() => Promise.resolve('turn')), status: AgentConnectionStatus.Connecting };
        render(session(), vi.fn());
        expect(feedState.composerProps?.aiAvailable).toBe(false);
        feedState.agent = connectedAgent(() => Promise.resolve('turn'));
        render(session(), vi.fn());
        expect(feedState.composerProps?.aiAvailable).toBe(true);
    });

    // A catalog without tables, enough to build the agent prompt
    const emptyCatalog = {
        flatten: () => ({
            read: () => ({
                catalogReader: { schemasLength: () => 0, tablesLength: () => 0, columnsLength: () => 0 },
                readName: () => '',
            }),
        }),
    };

    it('asks the agent without creating a script and runs the script the agent wrote', async () => {
        feedState.agent = connectedAgent((_sessionId, _prompt, listener) => {
            feedState.agentListener = listener;
            return Promise.resolve('turn-1');
        });
        const modify = vi.fn();
        render(withCatalog(session(), emptyCatalog), modify);

        await act(async () => feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai));
        expect(modify).not.toHaveBeenCalled();
        expect(feedState.agent.request).toHaveBeenCalledOnce();
        const [sessionId, prompt] = feedState.agent.request.mock.calls[0];
        expect(sessionId).toBe('session');
        expect(prompt).toContain('into a new script');
        expect(prompt).toContain('The connection speaks Tableau Hyper (PostgreSQL-compatible).');
        expect(prompt.endsWith('Question:\nhow many rows')).toBe(true);
        const waiting = { question: 'how many rows', status: 'waiting for agent...', error: null, note: null, scripts: [] };
        expect(feedState.composerProps?.agent?.turns).toEqual([{ questionId: 1, question: waiting, scripts: [] }]);
        await act(async () => feedState.agentListener!.status('running', 'dashql agent catalog'));
        expect(feedState.composerProps?.agent?.turns[0].question.status).toBe('dashql agent catalog');

        // The agent creates a script through the dashql command
        const created = withCatalog(session(['1_alpha.sql']), emptyCatalog);
        render(created, modify);
        await act(async () => feedState.agentListener!.edited(1));
        await act(async () => feedState.agentListener!.edited(1));
        expect(feedState.composerProps?.agent?.turns[0].scripts).toEqual([{ scriptKey: 1, scriptName: '1_alpha' }]);
        await act(async () => feedState.agentListener!.done('There are 3 rows'));
        const answered = { question: 'how many rows', status: null, error: null, note: 'There are 3 rows', scripts: [1] };
        expect(feedState.composerProps?.agent?.turns).toEqual([{ questionId: 1, question: answered, scripts: [{ scriptKey: 1, scriptName: '1_alpha' }] }]);
        expect(feedState.runSessionScript).toHaveBeenCalledExactlyOnceWith(created, created.scripts[1], feedState.executeQuery, modify, expect.anything());
        await act(async () => feedState.composerProps!.agent!.onDismiss(1));
        expect(feedState.composerProps?.agent?.turns).toEqual([]);
    });

    it('follows the agent to the scripts it edits and runs until the user takes over the feed', async () => {
        feedState.agent = connectedAgent((_sessionId, _prompt, listener) => {
            feedState.agentListener = listener;
            return Promise.resolve('turn-1');
        });
        // A short viewport that keeps the scripts apart, scrolling moves it
        const clientHeight = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(100);
        const scrollTo = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(function (this: Element, options?: ScrollToOptions | number) {
            const top = typeof options === 'object' ? options.top ?? 0 : 0;
            Object.defineProperty(this, 'scrollTop', { value: top, configurable: true });
        });
        try {
            render(withCatalog(session(['1_alpha.sql', '2_beta.sql', '3_gamma.sql']), emptyCatalog), vi.fn());
            await act(async () => feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai));
            scrollTo.mockClear();

            // An edit below the viewport scrolls to the script, a script in view stays where it is
            await act(async () => feedState.agentListener!.edited(3));
            expect(scrollTo).toHaveBeenCalledOnce();
            const scrolled = (scrollTo.mock.calls[0][0] as ScrollToOptions).top!;
            expect(scrolled).toBeGreaterThan(0);
            await act(async () => feedState.agentListener!.edited(3));
            expect(scrollTo).toHaveBeenCalledOnce();

            // A run of another script while the agent still works scrolls back to it.
            // The first script scrolls to the top of the feed, with the add button above it.
            await act(async () => feedState.agentListener!.ran(1));
            expect(scrollTo).toHaveBeenCalledTimes(2);
            expect(scrolled).toBeGreaterThan(0);
            expect((scrollTo.mock.calls[1][0] as ScrollToOptions).top!).toBe(0);

            // Once the user scrolls the feed, the agent's edits stay where they are
            act(() => container.querySelector('[data-testid="feed-list"]')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
            await act(async () => feedState.agentListener!.edited(3));
            expect(scrollTo).toHaveBeenCalledTimes(2);
        } finally {
            scrollTo.mockRestore();
            clientHeight.mockRestore();
        }
    });

    it('scrolls to a script that the insert button creates between two scripts', async () => {
        const clientHeight = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(100);
        const scrollTo = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(function (this: Element, options?: ScrollToOptions | number) {
            const top = typeof options === 'object' ? options.top ?? 0 : 0;
            Object.defineProperty(this, 'scrollTop', { value: top, configurable: true });
        });
        try {
            const before = session(['1_alpha.sql', '2_beta.sql', '3_gamma.sql']);
            // The created script lands between the second and the third script and takes the focus
            const created = session(['1_alpha.sql', '2_beta.sql', '3_gamma.sql', '4_delta.sql']);
            created.scriptOrder = ['1_alpha.sql', '2_beta.sql', '4_delta.sql', '3_gamma.sql'];
            const modify = vi.fn(() => Promise.resolve(created));
            render(before, modify);
            for (let i = 0; i < 3; ++i) act(() => feedState.rowProps.onRowHeightChange(i, 200));
            scrollTo.mockClear();

            act(() => feedState.rowProps.onCreate(2));
            expect(modify).toHaveBeenCalledExactlyOnceWith({ type: CREATE_SCRIPT, value: { index: 2 } });
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
            const renderFeed = (sessionScripts: SessionScripts) => act(() => root.render(<LoggerProvider>
                <SessionConnectionAttentionContext.Provider value={attention as any}>
                    <SessionFeed sessionScripts={sessionScripts} modifySessionScripts={vi.fn()} conn={onlineConn}
                        active={true} dependencies={{ ...feedDependencies, ScriptFeedRow }} />
                </SessionConnectionAttentionContext.Provider>
            </LoggerProvider>));
            const rows = () => Array.from(container.querySelectorAll<HTMLElement>('[data-testid="row"]'))
                .map(row => [row.dataset.scriptKey, row.dataset.mountedScriptKey]);
            renderFeed(session(['1_alpha.sql', '2_beta.sql']));
            expect(rows()).toEqual([['1', '1'], ['2', '2']]);

            // The created script lands above the first script, the rows of the first and the second script move down
            const created = session(['1_alpha.sql', '2_beta.sql', '3_gamma.sql']);
            created.scriptOrder = ['3_gamma.sql', '1_alpha.sql', '2_beta.sql'];
            renderFeed(created);
            expect(rows()).toEqual([['3', '3'], ['1', '1'], ['2', '2']]);
        } finally {
            clientHeight.mockRestore();
        }
    });

    it('follows the agent to the results of a script it runs', async () => {
        feedState.agent = connectedAgent((_sessionId, _prompt, listener) => {
            feedState.agentListener = listener;
            return Promise.resolve('turn-1');
        });
        feedState.rowLayouts.set(2, { text: 250, result: 150 });
        const clientHeight = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(100);
        const scrollTo = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(function (this: Element, options?: ScrollToOptions | number) {
            const top = typeof options === 'object' ? options.top ?? 0 : 0;
            Object.defineProperty(this, 'scrollTop', { value: top, configurable: true });
        });
        const lastTop = () => (scrollTo.mock.lastCall?.[0] as ScrollToOptions | undefined)?.top;
        try {
            render(withCatalog(session(['1_alpha.sql', '2_beta.sql']), emptyCatalog), vi.fn());
            await act(async () => feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai));
            act(() => feedState.rowProps.onRowHeightChange(0, 400));
            act(() => feedState.rowProps.onRowHeightChange(1, 400));

            // An edit shows the text of a script taller than the viewport, below the first script and the gap
            await act(async () => feedState.agentListener!.edited(2));
            await vi.waitFor(() => expect(lastTop()).toBe(32 + 400 + 32 - 16));
            // A run shows its results
            await act(async () => feedState.agentListener!.ran(2));
            await vi.waitFor(() => expect(lastTop()).toBe(32 + 400 + 32 + 250 - 16));
        } finally {
            scrollTo.mockRestore();
            clientHeight.mockRestore();
        }
    });

    it('runs a script that the agent did not run while the connection of the script is online', async () => {
        feedState.agent = connectedAgent((_sessionId, _prompt, listener) => {
            feedState.agentListener = listener;
            return Promise.resolve('turn-1');
        });
        const onLake = session(['1_alpha.sql']);
        onLake.scripts[1] = { ...onLake.scripts[1], connection: { ...onLake.scripts[1].connection, connectionId: 'lake' } };
        const lake = { ...onlineConn, connectionId: 'lake' };
        const offline = { ...onlineConn, connectionHealth: ConnectionHealth.FAILED };
        const ask = async () => {
            await act(async () => feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai));
            await act(async () => feedState.agentListener!.edited(1));
            await act(async () => feedState.agentListener!.done(''));
        };

        // The connection of the composer is online, the connection of the script is not
        render(withCatalog(onLake, emptyCatalog), vi.fn());
        await ask();
        expect(feedState.runSessionScript).not.toHaveBeenCalled();
        expect(attention.request).toHaveBeenCalledWith('session');

        // The connection of the script is online, the connection of the composer is not
        render(withCatalog(onLake, emptyCatalog), vi.fn(), offline, new Map([['database', offline], ['lake', lake]]));
        await ask();
        expect(feedState.runSessionScript).toHaveBeenCalledOnce();
    });

    it('does not rerun a script that the agent ran itself', async () => {
        feedState.agent = connectedAgent((_sessionId, _prompt, listener) => {
            feedState.agentListener = listener;
            return Promise.resolve('turn-1');
        });
        render(withCatalog(session(['1_alpha.sql']), emptyCatalog), vi.fn());
        await act(async () => feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai));
        await act(async () => feedState.agentListener!.edited(1));
        await act(async () => feedState.agentListener!.ran(1));
        await act(async () => feedState.agentListener!.done(''));
        expect(feedState.runSessionScript).not.toHaveBeenCalled();
    });

    it('drops a question that the agent finished without an answer and without scripts', async () => {
        feedState.agent = connectedAgent((_sessionId, _prompt, listener) => {
            feedState.agentListener = listener;
            return Promise.resolve('turn-1');
        });
        render(withCatalog(session(), emptyCatalog), vi.fn());
        await act(async () => feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai));
        await act(async () => feedState.agentListener!.done(''));
        expect(feedState.composerProps?.agent?.turns).toEqual([]);
        expect(feedState.runSessionScript).not.toHaveBeenCalled();
    });

    it('stops the agent', async () => {
        feedState.agent = connectedAgent((_sessionId, _prompt, listener) => {
            feedState.agentListener = listener;
            return Promise.resolve('turn-1');
        });
        render(withCatalog(session(), emptyCatalog), vi.fn());
        await act(async () => feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai));
        await act(async () => feedState.composerProps!.agent!.onStop(1));
        expect(feedState.agent.cancel).toHaveBeenCalledExactlyOnceWith('session', 'turn-1');
        expect(feedState.composerProps?.agent?.turns).toEqual([]);
        await act(async () => feedState.agentListener!.failed('Stopped', true));
        expect(feedState.composerProps?.agent?.turns).toEqual([]);
    });

    it('stops one question of the agent and keeps the others', async () => {
        const listeners: AgentTurnListener[] = [];
        feedState.agent = connectedAgent((_sessionId, _prompt, listener) => {
            listeners.push(listener);
            return Promise.resolve(`turn-${listeners.length}`);
        });
        render(withCatalog(session(), emptyCatalog), vi.fn());
        await act(async () => feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai));
        await act(async () => feedState.composerProps!.onSend('how many columns', ComposerInputMode.Ai));
        await act(async () => feedState.composerProps!.agent!.onStop(1));
        expect(feedState.agent.cancel).toHaveBeenCalledExactlyOnceWith('session', 'turn-1');
        await act(async () => listeners[0].failed('Stopped', true));
        expect(feedState.composerProps?.agent?.turns.map(t => t.question.question)).toEqual(['how many columns']);
    });

    it('keeps the questions of a session while the feed shows another session', async () => {
        feedState.agent = connectedAgent((_sessionId, _prompt, listener) => {
            feedState.agentListener = listener;
            return Promise.resolve('turn-1');
        });
        const first = withCatalog(session(['1_alpha.sql']), emptyCatalog);
        const other = { ...withCatalog(session(['1_beta.sql']), emptyCatalog), sessionId: 'other' };
        render(first, vi.fn());
        await act(async () => feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai));
        expect(feedState.composerProps?.agent?.turns.map(t => t.question.question)).toEqual(['how many rows']);

        // The other session shows none of the questions, and the agent runs no script in it
        render(other, vi.fn());
        expect(feedState.composerProps?.agent?.turns).toEqual([]);
        await act(async () => feedState.agentListener!.edited(1));
        await act(async () => feedState.agentListener!.done('There are 3 rows'));
        expect(feedState.composerProps?.agent?.turns).toEqual([]);
        expect(feedState.runSessionScript).not.toHaveBeenCalled();

        // Back in the session, the question shows with its answer
        render(first, vi.fn());
        expect(feedState.composerProps?.agent?.turns).toEqual([{
            questionId: 1,
            question: { question: 'how many rows', status: null, error: null, note: 'There are 3 rows', scripts: [1] },
            scripts: [{ scriptKey: 1, scriptName: '1_alpha' }],
        }]);
    });

    it('stops a question of a session after the feed showed another session', async () => {
        feedState.agent = connectedAgent(() => Promise.resolve('turn-1'));
        const first = withCatalog(session(), emptyCatalog);
        render(first, vi.fn());
        await act(async () => feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai));
        render({ ...first, sessionId: 'other' }, vi.fn());
        render(first, vi.fn());
        await act(async () => feedState.composerProps!.agent!.onStop(1));
        expect(feedState.agent.cancel).toHaveBeenCalledExactlyOnceWith('session', 'turn-1');
        expect(feedState.composerProps?.agent?.turns).toEqual([]);
    });

    it('stops a question before the agent server queued its turn', async () => {
        let queued: (turnId: string) => void = () => {};
        feedState.agent = connectedAgent(() => new Promise<string>(resolve => { queued = resolve; }));
        render(withCatalog(session(), emptyCatalog), vi.fn());
        act(() => { void feedState.composerProps!.onSend('how many rows', ComposerInputMode.Ai); });
        await vi.waitFor(() => expect(feedState.agent.request).toHaveBeenCalledOnce());
        await act(async () => feedState.composerProps!.agent!.onStop(1));
        expect(feedState.agent.cancel).not.toHaveBeenCalled();
        await act(async () => queued('turn-1'));
        expect(feedState.agent.cancel).toHaveBeenCalledExactlyOnceWith('session', 'turn-1');
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

    it('leaves Enter and Escape to an open modal dialog instead of a staged rewrite', () => {
        const modify = vi.fn(() => Promise.resolve(session(['1_alpha.sql'])));
        const current = session(['1_alpha.sql']);
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
        expect(modify).toHaveBeenLastCalledWith({ type: REJECT_PENDING_DIFF, value: 1 });
    });

    it('keeps the question with the error when the agent fails', async () => {
        feedState.agent = connectedAgent(() => Promise.reject(new Error('The agent server is not connected')));
        const modify = vi.fn();
        render(withCatalog(session(), emptyCatalog), modify);
        await act(async () => feedState.composerProps!.onSend('anything', ComposerInputMode.Ai));
        await vi.waitFor(() => expect(feedState.composerProps?.agent?.turns[0].question.error).toBe('The agent server is not connected'));
        expect(modify).not.toHaveBeenCalled();
        expect(feedState.runSessionScript).not.toHaveBeenCalled();
    });
});
