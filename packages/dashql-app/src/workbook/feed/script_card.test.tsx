import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dashql from '@akohn/dashql';

import { ConnectorType, CONNECTOR_INFOS } from '@akohn/dashql/platform/connections/connector_info';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { WorkbookConnectionAttentionContext } from '../workbook_connection_attention.js';
import { WorkbookReadOnlyContext } from '../workbook_read_only.js';
import type { ScriptConnectionView } from '../scripts/script_connection_picker.js';
import { fakeScript, fakeScriptModel } from '../../tests/fake_models.js';
import type { ScriptModel } from '../../runtime/models/script_model.js';
import { ScriptCard, type ScriptCardDependencies, type ScriptCardProps, type ScriptFeedCommands } from './script_card.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

// The card renders a model, the tests hand it a plain one. The parts that need a real script session are replaced.
const formatScriptEditor = vi.fn();
const DEPENDENCIES: ScriptCardDependencies = {
    ScriptDiagnosticsButton: () => <button>diagnostics</button>,
    ScriptStatisticsBar: () => null,
    ChartBuilderOverlay: () => null,
    isScriptFormattable: () => true,
    formatScriptEditor: (...args: Parameters<ScriptCardDependencies['formatScriptEditor']>) => {
        formatScriptEditor(...args);
        args[3]('SELECT 1;');
        return true;
    },
} as unknown as ScriptCardDependencies;

/// A connection of the card, Trino by default
function connection(health = ConnectionHealth.ONLINE, label = 'Trino', detail = ''): ScriptConnectionView {
    return {
        connectionId: 'database', connectionHealth: health, details: { setupParams: null, channel: null, connector: { kind: 'trino' } },
        connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], label: detail === '' ? label : `${label} ${detail}`, labelParts: { name: label, detail },
    } as unknown as ScriptConnectionView;
}

function feedCommands(): { [K in keyof ScriptFeedCommands]: ReturnType<typeof vi.fn> } {
    return {
        create: vi.fn(), focus: vi.fn(), delete: vi.fn(), rename: vi.fn(), pickConnection: vi.fn(), moveUp: vi.fn(),
        moveDown: vi.fn(), target: vi.fn(), editorView: vi.fn(),
    };
}

/// The props of a card of the script `01_alpha.sql`, the first of two scripts
function cardProps(model: ScriptModel = fakeScriptModel({ script: fakeScript(1, '01_alpha.sql') })) {
    const feed = feedCommands();
    const result = { expanded: true, toggle: vi.fn(), autoCollapse: vi.fn(), resetAutoCollapsed: vi.fn() };
    const props: ScriptCardProps = {
        model,
        connection: null,
        position: { index: 0, canMoveUp: false, canMoveDown: true },
        display: {
            focused: true, active: true, canTarget: true, scriptDebugMode: false, formattingDebugMode: false,
            keywordCase: dashql.buffers.formatting.KeywordCase.UPPER, references: null,
        },
        result,
        feed: feed as unknown as ScriptFeedCommands,
        storageReader: { backend: {}, getWorkbookLocation: () => ({ type: 'opfs' }) } as unknown as ScriptCardProps['storageReader'],
        editor: slot => <EditorSlot setView={slot.setView} />,
        resultPanel: slot => <button data-testid="result-panel" onClick={slot.onShowTable}>result</button>,
        resultTable: slot => (
            <div data-testid="result-table-overlay" data-script={slot.scriptName}>
                <button data-testid="result-table-overlay-close" onClick={slot.onClose} />
            </div>
        ),
        dependencies: DEPENDENCIES,
    };
    return { props, feed, result };
}

/// The editor of a test mounts a view, the format of the card needs one
function EditorSlot(props: { setView: (view: never) => void }) {
    React.useEffect(() => props.setView({} as never), [props.setView]);
    return <div data-testid="editor" />;
}

/// A query of the script that succeeded with a result
function succeeded(queryId: number, extra: Partial<QueryExecutionState> = {}): QueryExecutionState {
    return { queryId, traceId: 9, status: 9, resultTable: {}, ...extra } as unknown as QueryExecutionState;
}

describe('the card of a script', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        formatScriptEditor.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });
    const render = (props: ScriptCardProps, wrap: (card: React.ReactElement) => React.ReactElement = card => card) =>
        act(() => root.render(wrap(<ScriptCard {...props} />)));
    const click = (testId: string) => act(() => container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click());

    it('shows the scripts of a read-only workbook greyed out, without what runs or changes them', () => {
        render(cardProps().props, card => <WorkbookReadOnlyContext.Provider value={true}>{card}</WorkbookReadOnlyContext.Provider>);
        expect(container.querySelector('[data-testid="script-cell"]')!.hasAttribute('data-read-only')).toBe(true);
        expect(container.querySelector('[data-testid="script-read-only"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="editor"]')).not.toBeNull();
        for (const action of ['script-execute', 'script-delete', 'script-chart', 'script-snippets', 'script-more-actions',
            'script-move-up', 'script-move-down']) {
            expect(container.querySelector(`[data-testid="${action}"]`), action).toBeNull();
        }
    });

    it('marks a result that was loaded from the cache as cached in the status bar', async () => {
        const script = fakeScript(1, '01_alpha.sql', 'SELECT 1', { latestQueryId: 42, analysisOutdated: false, cachedResult: { key: 'key', cachedAt: Date.now() - 8 * 60_000 } } as never);
        const { props } = cardProps(fakeScriptModel({ script, query: succeeded(42, { servedFromCache: true } as never) }));
        render({ ...props, connection: connection() });
        expect(container.textContent).toContain('Result loaded from cache');
        await vi.waitFor(() => expect(container.querySelector('[data-testid="cached-result"]')).not.toBeNull());

        // Clicking the tag tells since when the result is cached
        click('cached-result');
        expect(document.querySelector('[data-testid="cached-result-detail"]')?.textContent).toContain('8 minutes ago');
    });

    it('focuses on pointer entry, shows the result and its table, formats, accepts and rejects a rewrite, moves and deletes', () => {
        const script = fakeScript(1, '01_alpha.sql', 'SELECT 1', { latestQueryId: 42 } as never);
        const model = fakeScriptModel({ script, query: succeeded(42) });
        const { props, feed } = cardProps(model);
        render({ ...props, connection: connection() });
        const article = container.querySelector('[data-testid="script-cell"]')!;
        act(() => article.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
        expect(feed.focus).toHaveBeenCalledWith('01_alpha.sql');

        // The result opens its full table over the feed
        expect(container.querySelector('[data-testid="result-table-overlay"]')).toBeNull();
        click('result-panel');
        expect(container.querySelector('[data-testid="result-table-overlay"]')?.getAttribute('data-script')).toBe('01_alpha');
        click('result-table-overlay-close');
        expect(container.querySelector('[data-testid="result-table-overlay"]')).toBeNull();

        // The script runs on Trino, it formats in the dialect of Trino and the model writes the text
        click('script-more-actions');
        act(() => document.querySelector<HTMLButtonElement>('[data-testid="script-menu-item"][data-action="format-compact"]')!.click());
        expect(formatScriptEditor).toHaveBeenCalledWith(
            expect.anything(), script, dashql.buffers.formatting.FormattingMode.COMPACT, expect.any(Function), false,
            dashql.buffers.formatting.KeywordCase.UPPER, dashql.buffers.formatting.FormattingDialect.TRINO,
        );
        expect(model.setText).toHaveBeenCalledWith('SELECT 1;');

        // A staged rewrite is accepted or rejected by the model
        render({ ...props, connection: connection(), model: { ...model, script: { ...script, pendingDiff: {} } as never } });
        click('diff-accept');
        expect(model.acceptDiff).toHaveBeenCalledOnce();
        click('diff-reject');
        expect(model.rejectDiff).toHaveBeenCalledOnce();

        // The feed moves and deletes the script
        expect(container.querySelector<HTMLButtonElement>('[data-testid="script-move-up"]')?.disabled).toBe(true);
        click('script-move-down');
        expect(feed.moveDown).toHaveBeenCalledWith('01_alpha.sql');
        click('script-delete');
        expect(feed.delete).toHaveBeenCalledWith('01_alpha.sql');
    });

    it('folds the result with the status bar and folds a result without rows by itself', () => {
        const script = fakeScript(1, '01_alpha.sql', 'SELECT 1', { latestQueryId: 42 } as never);
        const { props, result } = cardProps(fakeScriptModel({ script, query: succeeded(42, { resultTable: null } as never) }));
        render({ ...props, connection: connection() });
        expect(result.autoCollapse).toHaveBeenCalledWith(1, 42);
        render({ ...props, connection: connection(), result: { ...result, expanded: false } });
        expect(container.querySelector<HTMLElement>('#feed-result-1')!.hidden).toBe(true);
    });

    it('offers snippets next to the delete button unless a rewrite is pending, a snippet replaces the text', () => {
        const model = fakeScriptModel({ script: fakeScript(1, '01_alpha.sql') });
        const { props } = cardProps(model);
        render(props);
        const snippets = container.querySelector<HTMLButtonElement>('[data-testid="script-snippets"]')!;
        expect(snippets.disabled).toBe(false);
        const deleteButton = container.querySelector('[data-testid="script-delete"]')!;
        expect(snippets.compareDocumentPosition(deleteButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        render({ ...props, model: { ...model, script: { ...model.script, pendingDiff: {} } as never } });
        expect(container.querySelector<HTMLButtonElement>('[data-testid="script-snippets"]')!.disabled).toBe(true);
    });

    it('shows the connection instead of the file name and edits the file in the storage view', () => {
        const { props, feed } = cardProps();
        render({ ...props, connection: connection(ConnectionHealth.ONLINE, 'Trino', 'Http') });
        // The connection takes the place of the file name
        const picker = container.querySelector('[data-testid="script-connection-picker"]')!;
        expect(picker.textContent).toContain('Trino');
        // The header shows the logo of the database, neither the protocol nor the health
        expect(picker.textContent).not.toContain('Http');
        expect(picker.querySelector('use')?.getAttribute('xlink:href')).toContain(CONNECTOR_INFOS[ConnectorType.TRINO].icons.colored);
        expect(picker.textContent).not.toContain('01_alpha');

        click('script-more-actions');
        act(() => document.querySelector<HTMLButtonElement>('[data-testid="script-menu-item"][data-action="storage"]')!.click());
        const storage = document.querySelector('[data-testid="script-storage"]')!;
        expect(storage.textContent).toContain('opfs://workbooks/workbook/scripts/01_alpha.sql');
        const input = storage.querySelector<HTMLInputElement>('[data-testid="script-file-name-input"]')!;
        expect(input.value).toBe('01_alpha.sql');
        input.value = 'report';
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(feed.rename).toHaveBeenCalledExactlyOnceWith('01_alpha.sql', 'report');
    });

    it('mentions the script with a tag that shows its current name', () => {
        const { props, feed } = cardProps();
        render(props);
        const mention = container.querySelector<HTMLButtonElement>('[data-testid="script-mention"]')!;
        expect(mention.textContent).toBe(':01_alpha');
        act(() => mention.click());
        expect(feed.target).toHaveBeenCalledWith('01_alpha.sql');

        // A rename shows the new name right away
        render({ ...props, model: fakeScriptModel({ script: fakeScript(1, 'report.sql') }) });
        expect(container.querySelector('[data-testid="script-mention"]')!.textContent).toBe(':report');
    });

    it('renames the script in the tag from the action menu', async () => {
        const { props, feed } = cardProps();
        render(props);
        const setInputValue = (input: HTMLInputElement, value: string) => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve(null)));
        // Rename in the action menu edits the name in the tag, the header has no rename button
        const rename = () => {
            click('script-more-actions');
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
        expect(feed.target).toHaveBeenCalledTimes(2);
        expect(container.querySelector('[data-testid="script-name-input"]')).toBeNull();

        // The input keeps the focus after the menu closes
        rename();
        let input = container.querySelector<HTMLInputElement>('[data-testid="script-name-input"]')!;
        expect(input.value).toBe('01_alpha');
        await act(nextFrame);
        expect(document.activeElement).toBe(input);
        act(() => setInputValue(input, 'report'));
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(feed.rename).toHaveBeenCalledWith('01_alpha.sql', 'report');
        expect(container.querySelector('[data-testid="script-name-input"]')).toBeNull();

        // Escape abandons the edit
        rename();
        input = container.querySelector<HTMLInputElement>('[data-testid="script-name-input"]')!;
        act(() => setInputValue(input, 'other'));
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(feed.rename).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="script-mention"]')!.textContent).toBe(':01_alpha');
    });

    it('keeps Play available for SQL with parser diagnostics, Play runs the model', () => {
        const script = fakeScript(1, '01_alpha.sql', 'SELECT * FROM t QUALIFY x = 1', { analysisOutdated: false, editorUpdate: { analysisAvailable: true } } as never);
        const model = fakeScriptModel({ script });
        const { props } = cardProps(model);
        render({ ...props, connection: connection(ConnectionHealth.ONLINE, 'Trino', 'Http') });
        const play = container.querySelector('[data-testid="script-execute"]') as HTMLButtonElement;
        expect(play.disabled).toBe(false);
        act(() => play.click());
        expect(model.run).toHaveBeenCalledOnce();
    });

    it('greys the play button offline and requests attention once per pointer entry without opening settings', () => {
        const model = fakeScriptModel({ script: fakeScript(1, '01_alpha.sql') });
        const { props } = cardProps(model);
        const request = vi.fn();
        render(props, card => <WorkbookConnectionAttentionContext.Provider value={{ workbookId: 'workbook', active: false, request }}>
            {card}
        </WorkbookConnectionAttentionContext.Provider>);
        const play = container.querySelector<HTMLButtonElement>('[data-testid="script-execute"]')!;
        // The button stays a greyed play button that does not run the script
        expect(play.disabled).toBe(false);
        expect(play.getAttribute('aria-label')).toMatch(/^Execute /);
        const wrapper = container.querySelector<HTMLElement>('[data-execution-connection-blocked="true"]')!;
        expect(wrapper.contains(play)).toBe(true);
        act(() => {
            wrapper.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
            wrapper.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: play }));
            wrapper.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
        });
        expect(request).toHaveBeenCalledExactlyOnceWith('workbook');
        expect(wrapper.tabIndex).toBe(0);
        // A click pulses the connections as well, it opens nothing and runs nothing
        act(() => play.click());
        expect(request).toHaveBeenCalledTimes(2);
        expect(model.run).not.toHaveBeenCalled();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
});
