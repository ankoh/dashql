import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import {
    fakeButtonModule,
    fakeKeyEventsModule,
    fakeQueryExecutorModule,
    fakeSymbolIconModule,
    ResizeObserverMock,
    setKeyEventMockState,
    setQueryExecutorMockState,
} from '../../../test/view_mocks.js';

const mockState = vi.hoisted(() => ({
    executeQuery: vi.fn(),
    compileQuery: vi.fn(),
    createScript: vi.fn(),
    insertCompiledText: vi.fn(),
    formatCompiledScript: vi.fn(),
    formatScript: vi.fn(),
    isFormattable: true,
    queryStates: new Map<number, any>(),
    keyHandlers: [] as Array<{
        key: string;
        ctrlKey?: boolean;
        capture?: boolean;
        callback: (event: KeyboardEvent) => void;
    }>,
}));

vi.mock('../../config/app_config.js', () => ({ useAppConfig: () => ({ settings: {} }) }));
vi.mock('../../../ui/foundations/button.js', async () => fakeButtonModule(await import('react')));
vi.mock('../../../ui/foundations/symbol_icon.js', async () => fakeSymbolIconModule(await import('react')));
vi.mock('./script_editor.js', async () => {
    const React = await import('react');
    return {
        ScriptEditor: (props: { setView?: (view: unknown) => void }) => {
            React.useEffect(() => props.setView?.({ focus: vi.fn() }), [props.setView]);
            return React.createElement('div', { 'data-testid': 'script-editor' });
        },
    };
});
vi.mock('./script_name.js', async () => {
    const React = await import('react');
    return { ScriptName: () => React.createElement('span', null, 'script') };
});
vi.mock('../../../utils/key_events.js', () => fakeKeyEventsModule());
vi.mock('../connections/query_executor.js', () => fakeQueryExecutorModule());
vi.mock('../agent/agent_run_provider.js', () => ({
    useAgentRunState: () => null,
    useCancelAgentRun: () => vi.fn(),
}));
vi.mock('../persistence/storage_provider.js', () => ({
    useStorageReader: () => ({ backend: { deleteQueryResultCache: vi.fn() } }),
}));
vi.mock('./trace_log_panel.js', async () => {
    const React = await import('react');
    return { TraceLogPanel: () => React.createElement('div', { 'data-testid': 'trace-log-panel' }) };
});
vi.mock('./tab_header.js', async (importOriginal) => ({
    ...await importOriginal<typeof import('./tab_header.js')>(),
    useResultRowCount: () => ({ hasResult: false, totalRows: null }),
}));
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

import { ConnectionHealth, type ConnectionState } from '../connections/connection_state.js';
import * as dashql from '../../../core/index.js';
import { REGISTER_QUERY, type NotebookScripts } from '../scripts/notebook_scripts.js';
import { ScriptDetails } from './script_details.js';

function makeScriptData(scriptKey: number, text: string, fileName: string) {
    return {
        scriptKey,
        scriptSession: {
            getText: () => text,
            startExecution: () => ({}),
            compileQuery: () => ({
                ...mockState.compileQuery(),
                read: () => ({
                    errorsLength: () => 0,
                    sql: () => text,
                    cacheSignature: () => 'signature',
                    cacheable: () => true,
                }),
                destroy: () => { },
            }),
            analyze: () => { },
            format: mockState.formatScript,
            isFullyFormattable: () => mockState.isFormattable,
            getParsed: () => null,
            getAnalyzed: () => null,
        } as any,
        analysisOutdated: false,
        annotations: {} as any,
        statistics: [] as any,
        completion: null,
        pendingDiff: null,
        latestQueryId: null,
        latestAgentRunId: null,
        fileName,
        folderName: 'Main',
    };
}

function createNotebookScripts(): NotebookScripts {
    return {
        notebookId: crypto.randomUUID(),
        connectionId: crypto.randomUUID(),
        instance: { createScript: mockState.createScript } as any,
        notebookMetadata: {} as any,
        connectorInfo: {} as any,
        connectionCatalog: {} as any,
        scripts: {
            101: makeScriptData(101, 'select 1', '01-first.sql'),
            102: makeScriptData(102, 'select 2', '02-second.sql'),
            999: makeScriptData(999, '', ''),
        },
        uncommittedScriptId: 999,
        scriptFolders: {
            Main: {
                folderName: 'Main',
                scripts: {
                    '01-first.sql': { scriptId: 101, fileName: '01-first.sql' },
                    '02-second.sql': { scriptId: 102, fileName: '02-second.sql' },
                },
            },
        },
        scriptFocus: { folderName: 'Main', fileName: '01-first.sql', interactionCounter: 0 },
        semanticUserFocus: null,
    } as NotebookScripts;
}

describe('ScriptDetails', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        setKeyEventMockState(mockState);
        setQueryExecutorMockState(mockState);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        mockState.keyHandlers = [];
        mockState.executeQuery.mockReset();
        mockState.queryStates.clear();
        mockState.executeQuery.mockReturnValue([42, Promise.resolve(null)]);
        mockState.compileQuery.mockReset();
        mockState.compileQuery.mockReturnValue({});
        mockState.createScript.mockReset();
        mockState.createScript.mockReturnValue({
            insertTextAt: mockState.insertCompiledText,
            format: mockState.formatCompiledScript,
            ptr: { destroy: vi.fn() },
            toString: () => 'compiled sql',
        });
        mockState.insertCompiledText.mockReset();
        mockState.formatCompiledScript.mockReset();
        mockState.formatCompiledScript.mockImplementation(() => { throw new Error('Stop after recording config'); });
        mockState.formatScript.mockReset();
        mockState.formatScript.mockImplementation(() => { throw new Error('Stop after recording config'); });
        mockState.isFormattable = true;
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('executes the pinned card on Ctrl+E without leaving details', () => {
        const notebookScripts = createNotebookScripts();
        const modifyNotebookScripts = vi.fn();
        const hideDetails = vi.fn();
        const connection = { connectionId: 'test-connection', connectionHealth: ConnectionHealth.ONLINE } as ConnectionState;

        act(() => {
            root.render(
                <ScriptDetails
                    notebookScripts={notebookScripts}
                    modifyNotebookScripts={modifyNotebookScripts}
                    connection={connection}
                    hideDetails={hideDetails}
                    scriptId={102}
                />,
            );
        });

        const handler = mockState.keyHandlers.find(candidate =>
            candidate.key === 'e' && candidate.ctrlKey === true && candidate.capture === true);
        expect(handler).toBeDefined();

        const event = {
            preventDefault: vi.fn(),
            stopImmediatePropagation: vi.fn(),
        } as unknown as KeyboardEvent;
        act(() => handler!.callback(event));

        expect(hideDetails).not.toHaveBeenCalled();
        expect(mockState.executeQuery).toHaveBeenCalledWith('test-connection', expect.objectContaining({
            query: 'select 2',
            cacheable: true,
            cacheSignature: 'signature',
        }));
        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: REGISTER_QUERY, value: [102, 42] });
    });

    it('executes the pinned card from the paper-airplane button without leaving details', () => {
        const notebookScripts = createNotebookScripts();
        const modifyNotebookScripts = vi.fn();
        const hideDetails = vi.fn();
        const connection = { connectionId: 'test-connection', connectionHealth: ConnectionHealth.ONLINE } as ConnectionState;

        act(() => {
            root.render(
                <ScriptDetails
                    notebookScripts={notebookScripts}
                    modifyNotebookScripts={modifyNotebookScripts}
                    connection={connection}
                    hideDetails={hideDetails}
                    scriptId={102}
                />,
            );
        });

        const executeButton = container.querySelector('[aria-label="Execute second query"]') as HTMLButtonElement;
        expect(executeButton).not.toBeNull();
        act(() => executeButton.click());

        expect(hideDetails).not.toHaveBeenCalled();
        expect(mockState.executeQuery).toHaveBeenCalledWith('test-connection', expect.objectContaining({
            query: 'select 2',
            cacheable: true,
            cacheSignature: 'signature',
        }));
        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: REGISTER_QUERY, value: [102, 42] });
    });

    it('shows an idle result as a compact status row', () => {
        act(() => {
            root.render(
                <ScriptDetails
                    notebookScripts={createNotebookScripts()}
                    modifyNotebookScripts={vi.fn()}
                    connection={null}
                    hideDetails={vi.fn()}
                    scriptId={102}
                />,
            );
        });

        expect(container.querySelector('[data-testid="script-editor"]')).not.toBeNull();
        expect(container.textContent).toContain('Not run yet');
        expect(container.querySelector('[aria-label^="Expand result"]')?.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector('[role="separator"]')).toBeNull();
        expect(container.querySelectorAll('[data-script-details-avatar][aria-hidden="true"]')).toHaveLength(2);
    });

    it('expands the idle result from its status header and restores the compact row', () => {
        act(() => {
            root.render(
                <ScriptDetails
                    notebookScripts={createNotebookScripts()}
                    modifyNotebookScripts={vi.fn()}
                    connection={null}
                    hideDetails={vi.fn()}
                    scriptId={102}
                />,
            );
        });

        let statusHeader = container.querySelector<HTMLButtonElement>('[aria-label^="Expand result"]')!;
        expect(statusHeader.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector('[role="separator"]')).toBeNull();

        act(() => statusHeader.click());
        statusHeader = container.querySelector<HTMLButtonElement>('[aria-label^="Collapse result"]')!;
        expect(statusHeader.getAttribute('aria-expanded')).toBe('true');
        expect(container.querySelector('[role="separator"]')?.getAttribute('aria-valuenow')).toBe('40');

        act(() => statusHeader.click());
        expect(container.querySelector('[aria-label^="Expand result"]')).not.toBeNull();
        expect(container.querySelector('[role="separator"]')).toBeNull();
    });

    it('initially collapses a successful execution without a visible result', () => {
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[102] = { ...notebookScripts.scripts[102], latestQueryId: 42 };
        mockState.queryStates.set(42, {
            queryId: 42,
            traceId: 100,
            status: 9,
            resultTable: null,
        });

        act(() => {
            root.render(
                <ScriptDetails
                    notebookScripts={notebookScripts}
                    modifyNotebookScripts={vi.fn()}
                    connection={null}
                    hideDetails={vi.fn()}
                    scriptId={102}
                />,
            );
        });

        expect(container.querySelector('[aria-label^="Expand result"]')?.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector('[role="separator"]')).toBeNull();

        const statusHeader = container.querySelector<HTMLButtonElement>('[aria-label^="Expand result"]')!;
        act(() => statusHeader.click());
        expect(container.querySelector('[aria-label^="Collapse result"]')?.getAttribute('aria-expanded')).toBe('true');
    });

    it('shows formatting warnings from the details card header', () => {
        mockState.isFormattable = false;

        act(() => {
            root.render(
                <ScriptDetails
                    notebookScripts={createNotebookScripts()}
                    modifyNotebookScripts={vi.fn()}
                    connection={null}
                    hideDetails={vi.fn()}
                    scriptId={102}
                />,
            );
        });

        const diagnosticsButton = container.querySelector('[aria-label="Show script warnings"]') as HTMLButtonElement;
        expect(diagnosticsButton).not.toBeNull();
        act(() => diagnosticsButton.click());
        expect(document.querySelector('[role="dialog"][aria-label="Script diagnostics"]')?.textContent)
            .toContain('This script cannot be formatted');
    });

    it('offers pretty and compact formatting from the details card header', () => {
        act(() => {
            root.render(
                <ScriptDetails
                    notebookScripts={createNotebookScripts()}
                    modifyNotebookScripts={vi.fn()}
                    connection={null}
                    hideDetails={vi.fn()}
                    scriptId={102}
                />,
            );
        });

        const formatButton = container.querySelector('[aria-label="Format script"]') as HTMLButtonElement;
        expect(formatButton).not.toBeNull();

        act(() => formatButton.click());
        let menu = document.querySelector('[role="dialog"][aria-label="Script formatting"]') as HTMLElement;
        const prettyButton = Array.from(menu.querySelectorAll('button'))
            .find(button => button.textContent === 'Format Pretty') as HTMLButtonElement;
        act(() => prettyButton.click());
        expect(mockState.formatScript).toHaveBeenLastCalledWith(expect.objectContaining({
            mode: dashql.buffers.formatting.FormattingMode.PRETTY,
            maxWidth: 80,
            indentationWidth: 4,
        }), null);

        act(() => formatButton.click());
        menu = document.querySelector('[role="dialog"][aria-label="Script formatting"]') as HTMLElement;
        const compactButton = Array.from(menu.querySelectorAll('button'))
            .find(button => button.textContent === 'Format Compact') as HTMLButtonElement;
        act(() => compactButton.click());
        expect(mockState.formatScript).toHaveBeenLastCalledWith(expect.objectContaining({
            mode: dashql.buffers.formatting.FormattingMode.COMPACT,
            indentationWidth: 2,
        }), null);
    });

    it('uses the error icon when script diagnostics include errors', () => {
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[102].editorUpdate = {
            diagnostics: [
                {
                    source: dashql.buffers.editor.EditorDiagnosticSource.ANALYZER,
                    severity: dashql.buffers.editor.EditorDiagnosticSeverity.ERROR,
                    message: 'Unknown column',
                    textSpan: null,
                },
                {
                    source: dashql.buffers.editor.EditorDiagnosticSource.ANALYZER,
                    severity: dashql.buffers.editor.EditorDiagnosticSeverity.WARNING,
                    message: 'Unsupported visualization key',
                    textSpan: null,
                },
            ],
        } as any;

        act(() => {
            root.render(
                <ScriptDetails
                    notebookScripts={notebookScripts}
                    modifyNotebookScripts={vi.fn()}
                    connection={null}
                    hideDetails={vi.fn()}
                    scriptId={102}
                />,
            );
        });

        const diagnosticsButton = container.querySelector('[aria-label="Show script errors"]') as HTMLButtonElement;
        expect(diagnosticsButton).not.toBeNull();
        act(() => diagnosticsButton.click());
        const overlay = document.querySelector('[role="dialog"][aria-label="Script diagnostics"]');
        expect(overlay?.textContent).toContain('1 error, 1 warning');
        expect(overlay?.textContent).toContain('Unknown column');
        expect(overlay?.textContent).toContain('Unsupported visualization key');

        const errorDetails = document.querySelector('[aria-label="Show details: Unknown column"]') as HTMLButtonElement;
        act(() => errorDetails.click());
        const details = document.querySelector('[role="dialog"][aria-label="Diagnostic details"]');
        expect(details?.textContent).toContain('source');
        expect(details?.textContent).toContain('analyzer');
        expect(details?.textContent).toContain('severity');
        expect(details?.textContent).toContain('error');
        expect(document.querySelector('[role="dialog"][aria-label="Script diagnostics"]')).toBeNull();

        const closeButton = document.querySelector('[aria-label="Close diagnostic details"]') as HTMLButtonElement;
        act(() => closeButton.click());
        expect(document.querySelector('[role="dialog"][aria-label="Diagnostic details"]')).toBeNull();
    });
});
