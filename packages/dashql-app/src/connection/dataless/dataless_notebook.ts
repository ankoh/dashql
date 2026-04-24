import * as React from 'react';

import { EXAMPLES } from '../../notebook/example_scripts.js';
import { NotebookState } from '../../notebook/notebook_state.js';
import { useNotebookStateAllocator } from '../../notebook/notebook_state_registry.js';
import { ConnectionState } from '../connection_state.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { createDefaultNotebookWithSchemaPage } from '../default_notebook_setup.js';

export type NotebookSetupFn = (conn: ConnectionState, abort?: AbortSignal) => Promise<NotebookState>;

const demo_q1_url = new URL('../../../static/examples/demo/q1.sql', import.meta.url);
const demo_schema_url = new URL('../../../static/examples/demo/schema.sql', import.meta.url);

export function useDatalessNotebookSetup(): NotebookSetupFn {
    const allocateNotebookState = useNotebookStateAllocator();
    const logger = useLogger();

    return React.useCallback(async (conn: ConnectionState) => {
        // Fetch the scripts
        const fetchMainScript = fetch(EXAMPLES.TPCH.queries[0].source);
        const fetchSchemaScript = fetch(EXAMPLES.TPCH.schema.source);
        const [mainScriptResponse, schemaScriptResponse] = await Promise.all([
            fetchMainScript,
            fetchSchemaScript
        ]);

        // Store the script texts
        const mainScriptText = await mainScriptResponse.text();
        const schemaScriptText = await schemaScriptResponse.text();
        return createDefaultNotebookWithSchemaPage(conn, allocateNotebookState, logger, mainScriptText, schemaScriptText);

    }, [allocateNotebookState, logger]);
};

export function useDemoNotebookSetup(): NotebookSetupFn {
    const allocateNotebookState = useNotebookStateAllocator();
    const logger = useLogger();

    return React.useCallback(async (conn: ConnectionState) => {
        // Fetch the scripts
        const fetchMainScript = fetch(demo_q1_url);
        const fetchSchemaScript = fetch(demo_schema_url);
        const [mainScriptResponse, schemaScriptResponse] = await Promise.all([
            fetchMainScript,
            fetchSchemaScript
        ]);

        // Store the script texts
        const mainScriptText = await mainScriptResponse.text();
        const schemaScriptText = await schemaScriptResponse.text();
        return createDefaultNotebookWithSchemaPage(conn, allocateNotebookState, logger, mainScriptText, schemaScriptText);

    }, [allocateNotebookState, logger]);
}
