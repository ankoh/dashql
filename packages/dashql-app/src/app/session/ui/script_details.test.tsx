import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionHealth } from '../../connections/connection_state.js';
import { ConnectorType } from '../../connections/connector_info.js';
import * as dashql from '@ankoh/dashql-core';
import { DELETE_SCRIPT, RENAME_SCRIPT, SET_SCRIPT_TEXT, type SessionScripts } from '../scripts/session_scripts.js';
import { QueryResultRerunButton } from './query_result_cache_controls.js';
import { runSessionScript } from './rerun_query.js';
import { ScriptDetails, type ScriptDetailsDependencies } from './script_details.js';
import { SessionConnectionAttentionContext } from './session_connection_attention.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const state = { keyHandlers: [] as any[], executeQuery: vi.fn(), formatScriptEditor: vi.fn(), deleteCache: vi.fn(), outputProps: null as any };
/// Stable like the storage context
const storageReader = { backend: { deleteQueryResultCache: state.deleteCache }, getSessionLocation: () => ({}) };
const dependencies = {
    useAppConfig: () => ({ settings: {} }),
    useLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }),
    useKeyEvents: (handlers: any[]) => {
        React.useEffect(() => { state.keyHandlers = handlers; }, [handlers]);
    },
    useQueryState: () => null,
    useCancelQuery: () => vi.fn(),
    useQueryExecutor: () => state.executeQuery,
    useStorageReader: () => storageReader,
    useAttachScriptConnection: () => vi.fn(),
    isScriptFormattable: () => true,
    formatScriptEditor: (...args: any[]) => {
        state.formatScriptEditor(...args);
        args[3]('SELECT 2;');
    },
    runSessionScript,
    ScriptDetailsEditorPane: (props: any) => {
        React.useEffect(() => props.onEditorView({ focus: vi.fn() }), [props.onEditorView]);
        return <div>
            <button aria-label="Shrink script details" onClick={props.onHide}>shrink</button>
            {props.formatMenu}
            <div data-testid="details-editor">{props.scriptDisplay}</div>
        </div>;
    },
    ScriptDetailsOutputPane: (props: any) => { state.outputProps = props; return <div data-testid="output-pane" />; },
    VerticalSplit: (props: any) => <div>{props.first}{props.second}</div>,
} as unknown as ScriptDetailsDependencies;

function scripts(): SessionScripts {
    const scriptSession = {
        getText: () => 'SELECT 2', isFullyFormattable: () => true, compileQuery: () => ({
            read: () => ({ errorsLength: () => 0, sql: () => 'SELECT 2', cacheSignature: () => 'signature', cacheable: () => true }),
            destroy: () => {},
        }), startExecution: () => ({}),
    };
    const connection = { connectionId: 'database', connectorInfo: { connectorType: ConnectorType.TRINO } };
    return {
        sessionId: 'session', name: 'Test', pendingConnection: null, settings: { cacheQueryResults: true }, instance: {} as any, sessionMetadata: {} as any,
        scripts: { 1: { scriptKey: 1, fileName: '01_first.sql', scriptSession, analysisOutdated: false, annotations: {}, latestQueryId: null, connection } as any,
            2: { scriptKey: 2, fileName: '02_second.sql', scriptSession, analysisOutdated: false, annotations: {}, latestQueryId: null, connection } as any },
        scriptRefs: {
            '01_first.sql': { scriptId: 1, fileName: '01_first.sql' },
            '02_second.sql': { scriptId: 2, fileName: '02_second.sql' },
        },
        scriptOrder: ['01_first.sql', '02_second.sql'],
        scriptFocus: { fileName: '01_first.sql' }, semanticUserFocus: null,
    };
}

/// A connection the details header can label
function connectionState(connectionId: string, connectionHealth: ConnectionHealth): any {
    return { connectionId, connectionHealth, details: { type: null }, connectorInfo: { names: { displayLong: 'Trino' } } };
}

function menuItem(action: string): HTMLButtonElement | null {
    return document.querySelector(`[data-testid="script-menu-item"][data-action="${action}"]`);
}

describe('ScriptDetails V2 flat scripts', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => { state.keyHandlers = []; state.executeQuery.mockReset().mockReturnValue([42, Promise.resolve()]); state.formatScriptEditor.mockReset(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    it('pins a flat script by id rather than current focus', () => {
        act(() => root.render(<ScriptDetails sessionScripts={scripts()} modifySessionScripts={vi.fn()}
            connection={null} hideDetails={() => {}} scriptId={2} dependencies={dependencies} />));
        expect(container.textContent).toContain('second');
        expect(container.querySelector('[data-testid="details-editor"]')).not.toBeNull();
    });

    it('renames with the raw flat filename and clean requested name', () => {
        const modify = vi.fn();
        act(() => root.render(<ScriptDetails sessionScripts={scripts()} modifySessionScripts={modify}
            connection={null} hideDetails={() => {}} scriptId={2} dependencies={dependencies} />));
        act(() => (container.querySelector('[data-testid="script-more-actions"]') as HTMLButtonElement).click());
        act(() => menuItem('storage')!.click());
        const input = document.querySelector('[data-testid="script-file-name-input"]') as HTMLInputElement;
        act(() => {
            input.focus();
            input.value = 'report';
            input.blur();
        });
        expect(modify).toHaveBeenCalledWith({ type: RENAME_SCRIPT, value: { fileName: '02_second.sql', newFileName: 'report' } });
    });

    it('executes the pinned script from Ctrl+E', () => {
        const modify = vi.fn();
        const connection = connectionState('database', ConnectionHealth.ONLINE);
        act(() => root.render(<ScriptDetails sessionScripts={scripts()} modifySessionScripts={modify}
            connection={connection} hideDetails={() => {}} scriptId={2} dependencies={dependencies} />));
        const handler = state.keyHandlers.find(value => value.key === 'e' && value.ctrlKey === true);
        expect(handler).toBeDefined();
        act(() => handler.callback({ preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }));
        expect(state.executeQuery).toHaveBeenCalledWith('database', expect.objectContaining({ query: 'SELECT 2' }));
    });

    it('blocks pinned Ctrl+E and cached reruns before cache deletion while main is offline', async () => {
        const request = vi.fn();
        state.deleteCache.mockReset().mockResolvedValue(undefined);
        const connection = connectionState('main', ConnectionHealth.FAILED);
        act(() => root.render(<SessionConnectionAttentionContext.Provider value={{ sessionId: 'session', active: false, request }}>
            <ScriptDetails sessionScripts={scripts()} modifySessionScripts={vi.fn()}
                connection={connection} hideDetails={() => {}} scriptId={2} dependencies={dependencies} />
        </SessionConnectionAttentionContext.Provider>));
        const handler = state.keyHandlers.find(value => value.key === 'e' && value.ctrlKey === true);
        act(() => handler.callback({ preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }));
        expect(request).toHaveBeenCalledExactlyOnceWith('session');
        expect(state.executeQuery).not.toHaveBeenCalled();
        const rerun = React.Children.toArray(state.outputProps.statusActions.props.children)
            .find((child: any) => child.type === QueryResultRerunButton) as React.ReactElement<{ onRerun?: () => void }>;
        expect(rerun).toBeDefined();
        expect(rerun.props.onRerun).toBeUndefined();
        expect(state.deleteCache).not.toHaveBeenCalled();
    });

    it('executes unparseable remote SQL from Ctrl+E without caching', () => {
        const sessionScripts = scripts();
        const sql = 'SELECT * FROM t QUALIFY row_number() OVER (ORDER BY id) = 1';
        sessionScripts.scripts[2].scriptSession = {
            getText: () => sql,
            compileQuery: () => ({
                read: () => ({
                    errorsLength: () => 1,
                    errors: () => ({ message: () => 'syntax error' }),
                    sql: () => sql,
                    cacheSignature: () => '',
                    cacheable: () => false,
                }),
                destroy: () => {},
            }),
            startExecution: () => ({}),
        } as any;
        const connection = connectionState('database', ConnectionHealth.ONLINE);
        act(() => root.render(<ScriptDetails sessionScripts={sessionScripts} modifySessionScripts={vi.fn()}
            connection={connection} hideDetails={() => {}} scriptId={2} dependencies={dependencies} />));

        const handler = state.keyHandlers.find(value => value.key === 'e' && value.ctrlKey === true);
        expect(handler).toBeDefined();
        act(() => handler.callback({ preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }));
        expect(state.executeQuery).toHaveBeenCalledWith('database', expect.objectContaining({
            query: sql, cacheable: false, cacheSignature: '',
        }));
    });

    it('offers pretty and compact formatting modes', () => {
        const modify = vi.fn();
        act(() => root.render(<ScriptDetails sessionScripts={scripts()} modifySessionScripts={modify}
            connection={null} hideDetails={() => {}} scriptId={2} dependencies={dependencies} />));

        act(() => (container.querySelector('[data-testid="script-more-actions"]') as HTMLButtonElement).click());
        expect(menuItem('format-pretty')).not.toBeNull();
        expect(menuItem('format-compact')).not.toBeNull();
        expect(menuItem('delete')).not.toBeNull();

        act(() => menuItem('format-pretty')!.click());
        expect(state.formatScriptEditor).toHaveBeenCalledWith(expect.anything(), expect.anything(),
            dashql.buffers.formatting.FormattingMode.PRETTY, expect.any(Function), false,
            dashql.buffers.formatting.KeywordCase.LOWER, dashql.buffers.formatting.FormattingDialect.TRINO);
        expect(modify).toHaveBeenCalledWith({
            type: SET_SCRIPT_TEXT,
            value: { scriptKey: 2, text: 'SELECT 2;', withDiff: true },
        });
    });

    it('deletes the script from the more menu and returns to the feed', () => {
        const modify = vi.fn();
        const hideDetails = vi.fn();
        act(() => root.render(<ScriptDetails sessionScripts={scripts()} modifySessionScripts={modify}
            connection={null} hideDetails={hideDetails} scriptId={2} dependencies={dependencies} />));

        act(() => (container.querySelector('[data-testid="script-more-actions"]') as HTMLButtonElement).click());
        act(() => menuItem('delete')!.click());

        expect(modify).toHaveBeenCalledWith({ type: DELETE_SCRIPT, value: '02_second.sql' });
        expect(hideDetails).toHaveBeenCalledOnce();
    });
});
