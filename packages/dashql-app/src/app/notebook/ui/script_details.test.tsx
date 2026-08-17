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
} from '../../../shared/test/view_mocks.js';

const mockState = vi.hoisted(() => ({
    executeQuery: vi.fn(),
    compileQuery: vi.fn(),
    createScript: vi.fn(),
    insertCompiledText: vi.fn(),
    formatCompiledScript: vi.fn(),
    formatScript: vi.fn(),
    isFormattable: true,
    keyHandlers: [] as Array<{
        key: string;
        ctrlKey?: boolean;
        capture?: boolean;
        callback: (event: KeyboardEvent) => void;
    }>,
}));

vi.mock('../../config/app_config.js', () => ({ useAppConfig: () => ({ settings: {} }) }));
vi.mock('../../../shared/ui/foundations/button.js', async () => fakeButtonModule(await import('react')));
vi.mock('../../../shared/ui/foundations/symbol_icon.js', async () => fakeSymbolIconModule(await import('react')));
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
vi.mock('../../../shared/utils/key_events.js', () => fakeKeyEventsModule());
vi.mock('../connections/query_executor.js', () => fakeQueryExecutorModule());
vi.mock('../agent/agent_run_provider.js', () => ({
    useAgentRunState: () => null,
    useCancelAgentRun: () => vi.fn(),
}));
vi.mock('../persistence/storage_provider.js', () => ({
    useStorageReader: () => ({ backend: { deleteQueryResultCache: vi.fn() } }),
}));
vi.mock('../../../compute/computation_registry.js', () => ({
    useComputationRegistry: () => [{ tableComputations: {} }, vi.fn()],
}));
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

import { ConnectionHealth, type ConnectionState } from '../connections/connection_state.js';
import * as dashql from '../../../shared/core/index.js';
import { REGISTER_QUERY, type NotebookScripts } from '../scripts/notebook_scripts.js';
import { ScriptDetails } from './script_details.js';

function makeScriptData(scriptKey: number, text: string, fileName: string) {
    return {
        scriptKey,
        script: {
            toString: () => text,
            getStatementText: () => text,
            compileQuery: () => ({
                ...mockState.compileQuery(),
                read: () => ({
                    errorsLength: () => 0,
                    sql: () => text,
                }),
                destroy: () => { },
            }),
            analyze: () => { },
            format: mockState.formatScript,
            isFullyFormattable: () => mockState.isFormattable,
            getParsed: () => null,
            getAnalyzed: () => null,
        } as any,
        scriptAnalysis: {
            buffers: { parsed: null, analyzed: null, destroy: () => { } },
            outdated: false,
        },
        annotations: {} as any,
        statistics: [] as any,
        cursor: null,
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

    it('returns to the feed and executes the pinned card on Ctrl+E', () => {
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

        expect(hideDetails).toHaveBeenCalledOnce();
        expect(mockState.executeQuery).toHaveBeenCalledWith('test-connection', expect.objectContaining({
            query: 'select 2',
            cacheable: true,
        }));
        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: REGISTER_QUERY, value: [102, 42] });
    });

    it('returns to the feed and executes the pinned card from the paper-airplane button', () => {
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

        expect(hideDetails).toHaveBeenCalledOnce();
        expect(mockState.executeQuery).toHaveBeenCalledWith('test-connection', expect.objectContaining({
            query: 'select 2',
            cacheable: true,
        }));
        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: REGISTER_QUERY, value: [102, 42] });
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
        }), null);

        act(() => formatButton.click());
        menu = document.querySelector('[role="dialog"][aria-label="Script formatting"]') as HTMLElement;
        const compactButton = Array.from(menu.querySelectorAll('button'))
            .find(button => button.textContent === 'Format Compact') as HTMLButtonElement;
        act(() => compactButton.click());
        expect(mockState.formatScript).toHaveBeenLastCalledWith(expect.objectContaining({
            mode: dashql.buffers.formatting.FormattingMode.COMPACT,
        }), null);
    });

    it('only enables SQL conversion for scripts containing relational pipes', () => {
        const notebookScripts = createNotebookScripts();

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

        let formatButton = container.querySelector('[aria-label="Format script"]') as HTMLButtonElement;
        act(() => formatButton.click());
        let menu = document.querySelector('[role="dialog"][aria-label="Script formatting"]') as HTMLElement;
        let convertButton = Array.from(menu.querySelectorAll('button'))
            .find(button => button.textContent === 'Convert to SQL') as HTMLButtonElement;
        expect(convertButton.disabled).toBe(true);

        act(() => formatButton.click());
        notebookScripts.scripts[102].scriptAnalysis.buffers.parsed = {
            read: () => ({
                featureFlags: () => dashql.buffers.parser.ParsedScriptFeature.RELATIONAL_PIPE,
                scannerErrorsLength: () => 0,
                scannerErrors: () => null,
                parserErrorsLength: () => 0,
                parserErrors: () => null,
            }),
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

        formatButton = container.querySelector('[aria-label="Format script"]') as HTMLButtonElement;
        act(() => formatButton.click());
        menu = document.querySelector('[role="dialog"][aria-label="Script formatting"]') as HTMLElement;
        convertButton = Array.from(menu.querySelectorAll('button'))
            .find(button => button.textContent === 'Convert to SQL') as HTMLButtonElement;
        expect(convertButton.disabled).toBe(false);
        act(() => convertButton.click());
        expect(mockState.formatScript).not.toHaveBeenCalled();
        expect(mockState.compileQuery).toHaveBeenCalledOnce();
        expect(mockState.createScript).toHaveBeenCalledOnce();
        expect(mockState.insertCompiledText).toHaveBeenCalledWith(0, 'select 2');
        expect(mockState.formatCompiledScript).toHaveBeenCalledWith(expect.objectContaining({
            mode: dashql.buffers.formatting.FormattingMode.PRETTY,
            maxWidth: 80,
            indentationWidth: 4,
        }), null);
    });

    it('uses the error icon when script diagnostics include errors', () => {
        const notebookScripts = createNotebookScripts();
        notebookScripts.scripts[102].scriptAnalysis.buffers.analyzed = {
            read: () => ({
                errorsLength: () => 2,
                errors: (index: number) => ({
                    message: () => index === 0 ? 'Unknown column' : 'Unsupported visualization key',
                    severity: () => index === 0 ? 0 : 1,
                    errorType: () => index === 0 ? 0 : 2,
                    astNodeId: () => 7,
                    textSpan: () => null,
                    symbolSpan: () => null,
                }),
            }),
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
