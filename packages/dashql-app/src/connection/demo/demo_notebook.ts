import * as React from 'react';

import { NotebookState } from '../../notebook/notebook_state.js';
import { useNotebookStateAllocator } from '../../notebook/notebook_state_registry.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { createDefaultNotebookWithSchemaPage } from '../default_notebook_setup.js';

const demo_q1_url = new URL('../../../static/examples/demo/q1.sql', import.meta.url);
const schema_script_url = new URL('../../../static/examples/demo/schema.sql', import.meta.url);

export type NotebookSetupFn = (conn: ConnectionState, abort?: AbortSignal) => Promise<NotebookState>;

export function useDemoNotebookSetup(): NotebookSetupFn {
    const allocateNotebookState = useNotebookStateAllocator();
    const logger = useLogger();

    return React.useCallback(async (conn: ConnectionState) => {
        // Fetch the scripts
        const fetchMainScript = fetch(demo_q1_url);
        const fetchSchemaScript = fetch(schema_script_url);
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
