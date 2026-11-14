import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionHealth } from '@ankoh/dashql-runtime/connections/connection_state';
import { CONNECTION_ATTENTION_DURATION_MS, WorkbookConnectionAttentionContext, useWorkbookConnectionAttention } from './workbook_connection_attention.js';

describe('workbook connection attention', () => {
    let container: HTMLDivElement;
    let root: Root;
    let signal: ReturnType<typeof useWorkbookConnectionAttention>;
    function Probe(props: { workbookId: string; health: ConnectionHealth; databaseId?: string }) {
        signal = useWorkbookConnectionAttention(props.workbookId, `${props.databaseId ?? 'main'}:${props.health}`);
        return <WorkbookConnectionAttentionContext.Provider value={signal}><Child /></WorkbookConnectionAttentionContext.Provider>;
    }
    function Child() {
        const shared = React.useContext(WorkbookConnectionAttentionContext)!;
        return <span data-active={shared.active}>{shared.workbookId}</span>;
    }
    beforeEach(() => {
        vi.useFakeTimers();
        container = document.createElement('div');
        root = createRoot(container);
    });
    afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); });

    it('shares a finite coalesced pulse, rejects other workbooks, and never focuses', () => {
        act(() => root.render(<Probe workbookId="workbook" health={ConnectionHealth.NOT_STARTED} />));
        const focused = document.activeElement;
        act(() => signal.request('other'));
        expect(signal.active).toBe(false);
        act(() => signal.request('workbook'));
        expect(container.querySelector('[data-active="true"]')).not.toBeNull();
        act(() => vi.advanceTimersByTime(500));
        act(() => signal.request('workbook'));
        act(() => vi.advanceTimersByTime(CONNECTION_ATTENTION_DURATION_MS - 500));
        expect(signal.active).toBe(false);
        expect(document.activeElement).toBe(focused);
    });

    it('clears on workbook, main database, or health changes and leaves the health of the target to the caller', () => {
        const render = (workbookId: string, health: ConnectionHealth, connectionId = 'main') =>
            act(() => root.render(<Probe workbookId={workbookId} health={health} databaseId={connectionId} />));
        render('a', ConnectionHealth.NOT_STARTED);
        act(() => signal.request('a'));
        render('b', ConnectionHealth.NOT_STARTED);
        expect(signal.active).toBe(false);
        act(() => signal.request('b'));
        render('b', ConnectionHealth.NOT_STARTED, 'replacement');
        expect(signal.active).toBe(false);
        act(() => signal.request('b'));
        render('b', ConnectionHealth.ONLINE, 'replacement');
        expect(signal.active).toBe(false);
        // A script on another connection may be blocked while the main database is online
        act(() => signal.request('b'));
        expect(signal.active).toBe(true);
    });
});
