import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import {
    fakeButtonModule,
    fakeSymbolIconModule,
} from '../../test/view_mocks.js';

const mockState = vi.hoisted(() => ({
    executeQuery: vi.fn(),
    keyHandlers: [] as Array<{
        key: string;
        ctrlKey?: boolean;
        capture?: boolean;
        callback: (event: KeyboardEvent) => void;
    }>,
}));

vi.mock('../../app_config.js', () => ({ useAppConfig: () => ({ settings: {} }) }));
vi.mock('../foundations/button.js', async () => fakeButtonModule(await import('react')));
vi.mock('../foundations/symbol_icon.js', async () => fakeSymbolIconModule(await import('react')));
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
vi.mock('../../utils/key_events.js', () => ({
    useKeyEvents: (handlers: typeof mockState.keyHandlers) => {
        mockState.keyHandlers = handlers;
    },
}));
vi.mock('../../connection/query_executor.js', () => ({
    useQueryState: () => null,
    useQueryExecutor: () => mockState.executeQuery,
    useCancelQuery: () => vi.fn(),
}));
vi.mock('../../agent/agent_run_provider.js', () => ({
    useAgentRunState: () => null,
    useCancelAgentRun: () => vi.fn(),
}));
vi.mock('../../platform/storage/storage_provider.js', () => ({
    useStorageReader: () => ({ backend: { deleteQueryResultCache: vi.fn() } }),
}));
vi.mock('../../compute/computation_registry.js', () => ({
    useComputationRegistry: () => [{ tableComputations: {} }, vi.fn()],
}));

import { ConnectionHealth, type ConnectionState } from '../../connection/connection_state.js';
import { REGISTER_QUERY, type NotebookScripts } from '../../scripts/notebook_scripts.js';
import { ScriptDetails } from './script_details.js';

function makeScriptData(scriptKey: number, text: string, fileName: string) {
    return {
        scriptKey,
        script: {
            toString: () => text,
            analyze: () => { },
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
        instance: {} as any,
        notebookMetadata: {} as any,
        connectorInfo: {} as any,
        connectionCatalog: {} as any,
        scriptRegistry: {} as any,
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
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        mockState.keyHandlers = [];
        mockState.executeQuery.mockReset();
        mockState.executeQuery.mockReturnValue([42, Promise.resolve(null)]);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('returns to the feed and executes the pinned card on Ctrl+E', () => {
        const notebookScripts = createNotebookScripts();
        const modifyNotebookScripts = vi.fn();
        const hideDetails = vi.fn();
        const connection = { connectionHealth: ConnectionHealth.ONLINE } as ConnectionState;

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
        expect(mockState.executeQuery).toHaveBeenCalledWith(notebookScripts.notebookId, expect.objectContaining({
            query: 'select 2',
            cacheable: true,
        }));
        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: REGISTER_QUERY, value: [102, 42] });
    });

    it('returns to the feed and executes the pinned card from the paper-airplane button', () => {
        const notebookScripts = createNotebookScripts();
        const modifyNotebookScripts = vi.fn();
        const hideDetails = vi.fn();
        const connection = { connectionHealth: ConnectionHealth.ONLINE } as ConnectionState;

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
        expect(mockState.executeQuery).toHaveBeenCalledWith(notebookScripts.notebookId, expect.objectContaining({
            query: 'select 2',
            cacheable: true,
        }));
        expect(modifyNotebookScripts).toHaveBeenCalledWith({ type: REGISTER_QUERY, value: [102, 42] });
    });
});
