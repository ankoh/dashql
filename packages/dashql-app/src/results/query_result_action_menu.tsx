import * as React from 'react';
import * as dashql from '@akohn/dashql';

import { QueryExecutionStatus, type QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { QueryResultActionMenu as QueryResultActionMenuView } from '@akohn/dashql-react/components/query_result/query_result_action_menu';
import { useAppConfig } from '../config/app_config.js';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { scriptResultOwner, type ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { useRuntime, useQueryResultTable } from '@akohn/dashql-react/hooks';
import { createScriptFormatConfig, formattingDialectForConnector, getKeywordCase } from '../workbook/scripts/script_format.js';

// The actions of a query result in the app (QueryResultActionMenu of @akohn/dashql-react): the script of the result in
// the runtime, rewritten by the core with the formatting of the app

/// The script of a workbook that owns a query result, as the store of the runtime holds it
function findResultScript(runtime: Runtime, workbookId: string, owner: string): ScriptData | null {
    for (const scriptKey of runtime.store.get('workbook', workbookId)?.scriptKeys ?? []) {
        if (scriptResultOwner(workbookId, scriptKey) === owner) return runtime.store.get('script', scriptKey);
    }
    return null;
}

interface Props {
    query: QueryExecutionState;
}

/// The actions of a query result that rewrite the script of the result. Results without a script, e.g. of the
/// shell or the catalog, have no menu. The standalone shell also has no storage or scripts, so the hooks that need
/// them must not run for its results.
export function QueryResultActionMenu({ query }: Props): React.ReactElement | null {
    const workbookId = query.queryMetadata.workbookId;
    const owner = query.queryMetadata.resultOwner;
    if (workbookId == null || owner == null) return null;
    return <ScriptResultActionMenu query={query} workbookId={workbookId} owner={owner} />;
}

interface ScriptResultProps extends Props {
    workbookId: string;
    owner: string;
}

function ScriptResultActionMenu({ query, workbookId, owner }: ScriptResultProps): React.ReactElement {
    const runtime = useRuntime();
    const config = useAppConfig();
    const resultTable = useQueryResultTable(query);
    const hasResult = query.status === QueryExecutionStatus.SUCCEEDED && resultTable != null;
    // The script that the projection rewrites, kept until it is applied
    const scriptKey = React.useRef<number | null>(null);

    const projectColumns = () => {
        scriptKey.current = null;
        const script = findResultScript(runtime, workbookId, owner);
        if (script == null || resultTable == null) return null;
        const formatConfig = createScriptFormatConfig(
            dashql.buffers.formatting.FormattingMode.PRETTY,
            false,
            undefined,
            getKeywordCase(config?.settings),
            formattingDialectForConnector(runtime.connection(script.connectionId)?.connectorType as ConnectorType | undefined),
        );
        const columnNames = resultTable.schema.fields.map(field => field.name);
        try {
            const text = script.scriptSession.rewriteResultProjection(columnNames, formatConfig);
            scriptKey.current = script.scriptKey;
            return { text };
        } catch (error) {
            // The errors of the core are no instances of Error of this realm, their message says why
            return { error: stringifyError(error) };
        }
    };
    const applyProjection = (text: string) => {
        if (scriptKey.current == null) return;
        // Staged as a diff like the formatting, the user accepts or rejects it in the editor
        runtime.dispatch({ workbook: workbookId }, {
            kind: 'setScriptText',
            value: { scriptKey: scriptKey.current, text, withDiff: true },
        });
    };
    return <QueryResultActionMenuView hasResult={hasResult} projectColumns={projectColumns} applyProjection={applyProjection} />;
}
