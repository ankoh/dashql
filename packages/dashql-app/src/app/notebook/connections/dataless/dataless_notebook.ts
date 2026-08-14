import * as React from 'react';

import { EXAMPLES } from '../../scripts/example_scripts.js';
import { NotebookScripts } from '../../scripts/notebook_scripts.js';
import { useNotebookScriptsAllocator } from '../../scripts/notebook_scripts_registry.js';
import { ConnectionState } from '../connection_state.js';
import { useLogger } from '../../../../shared/platform/logger/logger_provider.js';
import { createDefaultNotebookScripts } from '../default_notebook_setup.js';

export type NotebookScriptsSetupFn = (conn: ConnectionState, abort?: AbortSignal) => Promise<NotebookScripts>;

const demo_q1_url = new URL('../../../static/examples/demo/q1.sql', import.meta.url);

export function useDatalessNotebookScriptsSetup(): NotebookScriptsSetupFn {
    const allocateNotebookScripts = useNotebookScriptsAllocator();
    const logger = useLogger();

    return React.useCallback(async (conn: ConnectionState) => {
        const mainScriptResponse = await fetch(EXAMPLES.TPCH.queries[0].source);
        const mainScriptText = await mainScriptResponse.text();
        return createDefaultNotebookScripts(conn, allocateNotebookScripts, logger, mainScriptText);
    }, [allocateNotebookScripts, logger]);
};

export function useDemoNotebookScriptsSetup(): NotebookScriptsSetupFn {
    const allocateNotebookScripts = useNotebookScriptsAllocator();
    const logger = useLogger();

    return React.useCallback(async (conn: ConnectionState) => {
        const mainScriptResponse = await fetch(demo_q1_url);
        const mainScriptText = await mainScriptResponse.text();
        return createDefaultNotebookScripts(conn, allocateNotebookScripts, logger, mainScriptText);
    }, [allocateNotebookScripts, logger]);
}
