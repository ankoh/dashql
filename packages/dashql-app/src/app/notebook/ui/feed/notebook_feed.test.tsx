import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dashql from '../../../../core/index.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = vi.hoisted(() => ({ query: null as any, agent: null as any, sortableTransform: null as any, formatScriptEditor: vi.fn() }));
vi.mock('../../connections/query_executor.js', () => ({
    useQueryState: () => state.query,
    useCancelQuery: () => vi.fn(),
    computeQueryCacheKeyForConnection: vi.fn(),
}));
vi.mock('../../agent/agent_run_provider.js', () => ({ useAgentRunState: () => state.agent, useCancelAgentRun: () => vi.fn() }));
vi.mock('../script_editor.js', async () => {
    const React = await import('react');
    return { ScriptEditor: (props: any) => {
        React.useEffect(() => props.setView?.({}), [props.setView]);
        return React.createElement('div', { 'data-testid': 'editor' });
    } };
});
vi.mock('../script_diagnostics.js', async () => {
    const React = await import('react');
    return { ScriptDiagnosticsButton: () => React.createElement('button', null, 'diagnostics') };
});
vi.mock('../script_statistics_bar.js', () => ({ ScriptStatisticsBar: () => null }));
vi.mock('../script_format.js', () => ({
    isScriptFormattable: () => true,
    formatScriptEditor: state.formatScriptEditor,
}));
vi.mock('../query_result_cache_controls.js', () => ({ CachedResultBean: () => null, QueryResultCacheLabel: () => null, QueryResultRerunButton: () => null }));
vi.mock('../entry_status_bar.js', async () => {
    const React = await import('react');
    return { EntryStatusBar: (props: any) => React.createElement('button', { 'data-testid': 'status', onClick: props.onToggleExpanded }, props.status.message) };
});
vi.mock('./feed_entry_footer.js', async () => {
    const React = await import('react');
    return { FeedEntryFooter: () => React.createElement('div', { 'data-testid': 'integrated-footer' }, 'footer') };
});
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@dnd-kit/sortable', () => ({
    useSortable: () => ({
        attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: state.sortableTransform, transition: undefined, isDragging: false,
    }),
}));
vi.mock('@dnd-kit/utilities', () => ({
    CSS: {
        Translate: {
            toString: (transform: { x: number; y: number } | null) => transform == null
                ? undefined
                : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        },
    },
}));

import { ScriptFeedRow } from './notebook_feed_row.js';

function baseProps() {
    return {
        notebookId: 'notebook', connection: null, storageReader: { backend: { hasCachedQueryResult: vi.fn() } },
        entries: [{ scriptId: 1, fileName: '01_alpha.sql' }, { scriptId: 2, fileName: '02_beta.sql' }],
        scripts: { 1: script(1, '01_alpha.sql'), 2: script(2, '02_beta.sql') }, scriptDebugMode: false, formattingDebugMode: false,
        focusedFileName: '01_alpha.sql', canDelete: true, active: true, onFocus: vi.fn(), onDelete: vi.fn(),
        onRename: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), onExecute: vi.fn(), onShowStatus: vi.fn(),
        onShowAgentStatus: vi.fn(), onShowTable: vi.fn(), onShowVisualization: vi.fn(), onShowDetails: vi.fn(), onRerun: vi.fn(),
        onAcceptDiff: vi.fn(), onRejectDiff: vi.fn(), collapsedResults: new Map(), onToggleResultExpanded: vi.fn(),
        onAutoCollapseResult: vi.fn(), onResetAutoCollapsedResult: vi.fn(), topPadding: 16,
        onCreate: vi.fn(), onEditorView: vi.fn(), onRowHeightChange: vi.fn(),
    };
}

function script(scriptKey: number, fileName: string) {
    return { scriptKey, fileName, scriptSession: { getText: () => 'SELECT 1' }, analysisOutdated: true,
        annotations: {}, statistics: [], completion: null, pendingDiff: null, latestQueryId: null, latestAgentRunId: null };
}

describe('V2 notebook feed rows', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => { state.query = null; state.agent = null; state.sortableTransform = null; state.formatScriptEditor.mockReset(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    it('renders insertion separators before, between, and after flat scripts', () => {
        const props = baseProps();
        act(() => root.render(<>{[0, 2, 4].map(index => <ScriptFeedRow key={index} {...({ ...props, index, style: {} } as any)} />)}</>));
        expect(Array.from(container.querySelectorAll('button')).map(button => button.getAttribute('aria-label'))).toEqual([
            'Add script at position 1', 'Add script at position 2', 'Add script at position 3',
        ]);
        expect((container.firstElementChild as HTMLElement).style.paddingTop).toBe('16px');
        act(() => (container.querySelector('[aria-label="Add script at position 2"]') as HTMLButtonElement).click());
        expect(props.onCreate).toHaveBeenCalledWith(1);
    });

    it('focuses on pointer entry and exposes integrated execution footer', () => {
        const props = baseProps();
        props.scripts[1] = { ...props.scripts[1], latestQueryId: 42 } as any;
        state.query = { queryId: 42, traceId: 9, status: 9, resultTable: {} };
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 1, style: {} } as any)} />));
        const article = container.querySelector('article')!;
        act(() => article.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
        expect(props.onFocus).toHaveBeenCalledWith('01_alpha.sql');
        expect(container.querySelector('[data-testid="status"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="integrated-footer"]')).not.toBeNull();
        expect(container.querySelector('[aria-label="Drag alpha script to reorder"]')).not.toBeNull();
        const moreButton = container.querySelector('[aria-label="More actions for alpha script"]') as HTMLButtonElement;
        expect(moreButton).not.toBeNull();
        act(() => moreButton.click());
        const compactButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Format Compact') as HTMLButtonElement;
        expect(compactButton).not.toBeNull();
        act(() => compactButton.click());
        expect(state.formatScriptEditor).toHaveBeenCalledWith(
            expect.anything(),
            props.scripts[1],
            dashql.buffers.formatting.FormattingMode.COMPACT,
            false,
        );
        const expandButton = container.querySelector('[aria-label="Expand alpha script details"]') as HTMLButtonElement;
        const moveUpButton = container.querySelector('[aria-label="Move script up"]') as HTMLButtonElement;
        const moveDownButton = container.querySelector('[aria-label="Move script down"]') as HTMLButtonElement;
        expect(moreButton.compareDocumentPosition(moveUpButton) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
        expect(moveUpButton.compareDocumentPosition(moveDownButton) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
        expect(moveDownButton.compareDocumentPosition(expandButton) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
        act(() => expandButton.click());
        expect(props.onShowDetails).toHaveBeenCalledWith('01_alpha.sql');
        expect(container.querySelector('[aria-label="Move script up"]')?.hasAttribute('disabled')).toBe(true);
        expect(container.querySelector('[aria-label="Move script down"]')?.hasAttribute('disabled')).toBe(false);
    });

    it('lets the virtual list observe the row content height', () => {
        const props = baseProps();
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 312 } as DOMRect);
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 1, style: {} } as any)} />));
        expect((container.firstElementChild as HTMLElement).style.height).toBe('');
        expect(props.onRowHeightChange).toHaveBeenCalledWith(1, 312);
        rect.mockRestore();
    });

    it('translates a dragged card without applying dnd-kit scale distortion', () => {
        const props = baseProps();
        state.sortableTransform = { x: 0, y: 120, scaleX: 0.8, scaleY: 0.4 };
        act(() => root.render(<ScriptFeedRow {...({ ...props, index: 1, style: {} } as any)} />));

        const item = container.querySelector('[aria-label="Drag alpha script to reorder"]')!.parentElement as HTMLElement;
        expect(item.style.transform).toBe('translate3d(0px, 120px, 0)');
        expect(item.style.transform).not.toContain('scale');
    });
});
