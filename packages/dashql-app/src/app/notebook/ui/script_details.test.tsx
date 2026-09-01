import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const state = vi.hoisted(() => ({ keyHandlers: [] as any[], executeQuery: vi.fn(), formatScriptEditor: vi.fn() }));
vi.mock('../../config/app_config.js', () => ({ useAppConfig: () => ({ settings: {} }) }));
vi.mock('../../../platform/logger/logger_provider.js', () => ({ useLogger: () => ({ debug: vi.fn(), warn: vi.fn() }) }));
vi.mock('../../../utils/key_events.js', async () => {
    const React = await import('react');
    return {
        useKeyEvents: (handlers: any[]) => {
            React.useEffect(() => { state.keyHandlers = handlers; }, [handlers]);
        },
    };
});
vi.mock('../connections/query_executor.js', () => ({
    useQueryState: () => null, useCancelQuery: () => vi.fn(), useQueryExecutor: () => state.executeQuery,
}));
vi.mock('../agent/agent_run_provider.js', () => ({ useAgentRunState: () => null, useCancelAgentRun: () => vi.fn() }));
vi.mock('../persistence/storage_provider.js', () => ({ useStorageReader: () => ({ backend: { deleteQueryResultCache: vi.fn() } }) }));
vi.mock('./script_editor.js', async () => {
    const React = await import('react');
    return { ScriptEditor: () => React.createElement('div', { 'data-testid': 'details-editor' }) };
});
vi.mock('./script_details_panes.js', async () => {
    const React = await import('react');
    return {
        ScriptDetailsEditorPane: (props: any) => React.createElement('div', null,
            React.createElement('button', { 'aria-label': 'Rename script', onClick: props.onStartEditingName }, 'rename'),
            React.createElement('button', { 'aria-label': 'Shrink script details', onClick: props.onHide }, 'shrink'),
            props.formatMenu,
            props.isEditingName ? React.createElement('input', {
                ref: props.editInputRef,
                value: props.draftFileName,
                onChange: (event: any) => props.onDraftFileNameChange(event.target.value),
                onKeyDown: (event: any) => event.key === 'Enter' && props.onSaveName(),
            }) : null,
            React.createElement('div', { 'data-testid': 'details-editor' }, props.scriptDisplay),
        ),
        ScriptDetailsOutputPane: () => React.createElement('div', { 'data-testid': 'output-pane' }),
    };
});
vi.mock('./script_diagnostics.js', () => ({ ScriptDiagnosticsButton: () => null }));
vi.mock('./script_format.js', () => ({
    isScriptFormattable: () => true,
    formatScriptEditor: state.formatScriptEditor,
}));
vi.mock('./rerun_query.js', () => ({ runNotebookScript: (_databaseId: string, _scripts: unknown, script: any, execute: any) => execute('database', { query: script.scriptSession.getText() }) }));
vi.mock('../../../ui/foundations/vertical_split.js', async () => {
    const React = await import('react');
    return { VerticalSplit: (props: any) => React.createElement('div', null, props.first, props.second) };
});

import { ConnectionHealth } from '../connections/attached_database_state.js';
import { DELETE_SCRIPT, RENAME_SCRIPT, type NotebookScripts } from '../scripts/notebook_scripts.js';
import { ScriptDetails } from './script_details.js';

function scripts(): NotebookScripts {
    const scriptSession = {
        getText: () => 'SELECT 2', isFullyFormattable: () => true, compileQuery: () => ({
            read: () => ({ errorsLength: () => 0, sql: () => 'SELECT 2', cacheSignature: () => 'signature', cacheable: () => true }),
            destroy: () => {},
        }), startExecution: () => ({}),
    };
    return {
        notebookId: 'notebook', name: 'Test', databaseId: 'database', instance: {} as any, notebookMetadata: {} as any,
        connectorInfo: {} as any, connectionCatalog: {} as any,
        scripts: { 1: { scriptKey: 1, fileName: '01_first.sql', scriptSession, annotations: {}, latestQueryId: null, latestAgentRunId: null } as any,
            2: { scriptKey: 2, fileName: '02_second.sql', scriptSession, annotations: {}, latestQueryId: null, latestAgentRunId: null } as any },
        scriptRefs: {
            '01_first.sql': { scriptId: 1, fileName: '01_first.sql' },
            '02_second.sql': { scriptId: 2, fileName: '02_second.sql' },
        },
        scriptFocus: { fileName: '01_first.sql', interactionCounter: 0 }, semanticUserFocus: null,
    };
}

describe('ScriptDetails V2 flat scripts', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => { state.keyHandlers = []; state.executeQuery.mockReset().mockReturnValue([42, Promise.resolve()]); state.formatScriptEditor.mockReset(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    it('pins a flat script by id rather than current focus', () => {
        act(() => root.render(<ScriptDetails notebookScripts={scripts()} modifyNotebookScripts={vi.fn()}
            connection={null} hideDetails={() => {}} scriptId={2} />));
        expect(container.textContent).toContain('second');
        expect(container.querySelector('[data-testid="details-editor"]')).not.toBeNull();
    });

    it('renames with the raw flat filename and clean requested name', () => {
        const modify = vi.fn();
        act(() => root.render(<ScriptDetails notebookScripts={scripts()} modifyNotebookScripts={modify}
            connection={null} hideDetails={() => {}} scriptId={2} />));
        const edit = container.querySelector('[aria-label="Rename script"]') as HTMLButtonElement;
        act(() => edit.click());
        const input = container.querySelector('input') as HTMLInputElement;
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setter.call(input, 'report');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(modify).toHaveBeenCalledWith({ type: RENAME_SCRIPT, value: { fileName: '02_second.sql', newFileName: 'report' } });
    });

    it('executes the pinned script from Ctrl+E', () => {
        const modify = vi.fn();
        const connection = { databaseId: 'database', connectionHealth: ConnectionHealth.ONLINE } as any;
        act(() => root.render(<ScriptDetails notebookScripts={scripts()} modifyNotebookScripts={modify}
            connection={connection} hideDetails={() => {}} scriptId={2} />));
        const handler = state.keyHandlers.find(value => value.key === 'e' && value.ctrlKey === true);
        expect(handler).toBeDefined();
        act(() => handler.callback({ preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }));
        expect(state.executeQuery).toHaveBeenCalledWith('database', expect.objectContaining({ query: 'SELECT 2' }));
    });

    it('offers pretty and compact formatting modes', () => {
        act(() => root.render(<ScriptDetails notebookScripts={scripts()} modifyNotebookScripts={vi.fn()}
            connection={null} hideDetails={() => {}} scriptId={2} />));

        act(() => (container.querySelector('[aria-label="More actions for second script"]') as HTMLButtonElement).click());
        const labels = Array.from(document.querySelectorAll('button')).map(button => button.textContent);
        expect(labels).toContain('Format Pretty');
        expect(labels).toContain('Format Compact');
        expect(labels).toContain('Delete');
    });

    it('deletes the script from the more menu and returns to the feed', () => {
        const modify = vi.fn();
        const hideDetails = vi.fn();
        act(() => root.render(<ScriptDetails notebookScripts={scripts()} modifyNotebookScripts={modify}
            connection={null} hideDetails={hideDetails} scriptId={2} />));

        act(() => (container.querySelector('[aria-label="More actions for second script"]') as HTMLButtonElement).click());
        const deleteButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Delete') as HTMLButtonElement;
        act(() => deleteButton.click());

        expect(modify).toHaveBeenCalledWith({ type: DELETE_SCRIPT, value: '02_second.sql' });
        expect(hideDetails).toHaveBeenCalledOnce();
    });

    it('exposes one control to shrink back to the feed', () => {
        act(() => root.render(<ScriptDetails notebookScripts={scripts()} modifyNotebookScripts={vi.fn()}
            connection={null} hideDetails={() => {}} scriptId={2} />));

        expect(container.querySelectorAll('[aria-label="Shrink script details"]')).toHaveLength(1);
        expect(container.querySelector('[aria-label="Close script details"]')).toBeNull();
    });
});
