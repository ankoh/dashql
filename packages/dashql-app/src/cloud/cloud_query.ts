import * as React from 'react';
import * as arrow from 'apache-arrow';

import { salesforceCatalogDatabase, type ConnectionParams } from '@ankoh/dashql/platform/connections/connection_params';
import type { QueryExecutor } from '@ankoh/dashql/platform/connections/query_execution_args';
import { QueryType } from '@ankoh/dashql/platform/query/query_execution_state';
import { CLOUD_DATABASE, type CloudQuery } from './cloud_store_schema.js';
import { useOptionalRuntime } from '../runtime/runtime_hooks.js';

/// The database of DashQL in a cloud connection, by the alias that its sessions attach it as. Database.com attaches the
/// Hyper Cloud database of its settings as "lakehouse", a Hyper server and the local cloud attach it as "dashql".
export function cloudDatabaseOf(params: ConnectionParams | null | undefined): string {
    return params != null && 'dbcom' in params ? salesforceCatalogDatabase() : CLOUD_DATABASE;
}

/// Run the statements of the cloud store on a cloud connection through the query executor, the queries viewer lists
/// them. A statement without a result gives an empty table.
export function cloudQueryOf(executor: QueryExecutor, connectionId: string): CloudQuery {
    return async (sql: string, signal?: AbortSignal) => {
        const [, execution] = executor(connectionId, {
            query: sql,
            abortSignal: signal,
            analyzeResults: false,
            throwOnError: true,
            metadata: {
                queryType: QueryType.CLOUD_STORE,
                title: 'Cloud Store',
                description: null,
                issuer: 'Cloud',
                userProvided: false,
            },
        });
        return await execution ?? new arrow.Table();
    };
}

/// The query executor of the runtime, resolved when a query runs
function useExecutor(): QueryExecutor {
    const runtime = useOptionalRuntime();
    return React.useCallback<QueryExecutor>((connectionId, args) => {
        if (runtime == null) throw new Error('the query executor needs a RuntimeProvider');
        return runtime.execute(connectionId, args);
    }, [runtime]);
}

/// The statements of the cloud store on a cloud connection, see cloudQueryOf
export function useCloudQuery(connectionId: string | null): CloudQuery | null {
    const executor = useExecutor();
    return React.useMemo(() => connectionId == null ? null : cloudQueryOf(executor, connectionId), [connectionId, executor]);
}

/// The statements of the cloud store on any cloud connection, see cloudQueryOf
export function useCloudQueries(): (connectionId: string) => CloudQuery {
    const executor = useExecutor();
    return React.useCallback((connectionId: string) => cloudQueryOf(executor, connectionId), [executor]);
}
