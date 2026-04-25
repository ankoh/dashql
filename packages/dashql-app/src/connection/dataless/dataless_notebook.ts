import * as React from 'react';

import { EXAMPLES } from '../../notebook/example_scripts.js';
import { NotebookState } from '../../notebook/notebook_state.js';
import { useNotebookStateAllocator } from '../../notebook/notebook_state_registry.js';
import { ConnectionState } from '../connection_state.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { createDefaultNotebook } from '../default_notebook_setup.js';

export type NotebookSetupFn = (conn: ConnectionState, abort?: AbortSignal) => Promise<NotebookState>;

const demo_q1_url = new URL('../../../static/examples/demo/q1.sql', import.meta.url);

export function useDatalessNotebookSetup(): NotebookSetupFn {
    const allocateNotebookState = useNotebookStateAllocator();
    const logger = useLogger();

    return React.useCallback(async (conn: ConnectionState) => {
        const mainScriptResponse = await fetch(EXAMPLES.TPCH.queries[0].source);
        const mainScriptText = await mainScriptResponse.text();
        return createDefaultNotebook(conn, allocateNotebookState, logger, mainScriptText);
    }, [allocateNotebookState, logger]);
};

export function useDemoNotebookSetup(): NotebookSetupFn {
    const allocateNotebookState = useNotebookStateAllocator();
    const logger = useLogger();

    return React.useCallback(async (conn: ConnectionState) => {
        const mainScriptResponse = await fetch(demo_q1_url);
        const mainScriptText = await mainScriptResponse.text();
        return createDefaultNotebook(conn, allocateNotebookState, logger, mainScriptText);
    }, [allocateNotebookState, logger]);
}
