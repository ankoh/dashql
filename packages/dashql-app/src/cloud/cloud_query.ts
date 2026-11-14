import * as React from 'react';
import * as arrow from 'apache-arrow';

import type { ConnectionParams } from '@ankoh/dashql-runtime/connections/connection_params';
import { useQueryExecutor, type QueryExecutor } from '../connections/query_executor.js';
import { SALESFORCE_CATALOG_DATABASE } from '@ankoh/dashql-runtime/connections/salesforce/salesforce_catalog_update';
import { QueryType } from '@ankoh/dashql-runtime/query/query_execution_state';
import { CLOUD_DATABASE, type CloudQuery } from './cloud_store_schema.js';

/// The database of DashQL in a cloud connection, by the alias that its sessions attach it as. Database.com attaches the
/// Hyper Cloud database of its settings as "lakehouse", a Hyper server and the local cloud attach it as "dashql".
export function cloudDatabaseOf(params: ConnectionParams | null | undefined): string {
    return params != null && 'dbcom' in params ? SALESFORCE_CATALOG_DATABASE : CLOUD_DATABASE;
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

/// The statements of the cloud store on a cloud connection, see cloudQueryOf
export function useCloudQuery(connectionId: string | null): CloudQuery | null {
    const executor = useQueryExecutor();
    return React.useMemo(() => connectionId == null ? null : cloudQueryOf(executor, connectionId), [connectionId, executor]);
}

/// The statements of the cloud store on any cloud connection, see cloudQueryOf
export function useCloudQueries(): (connectionId: string) => CloudQuery {
    const executor = useQueryExecutor();
    return React.useCallback((connectionId: string) => cloudQueryOf(executor, connectionId), [executor]);
}
