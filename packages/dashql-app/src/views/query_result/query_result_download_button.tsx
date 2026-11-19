import * as React from 'react';
import type * as arrow from 'apache-arrow';

import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { exportArrowTableAsParquet, supportsParquetExport } from '@akohn/dashql/platform/hyperdb/hyperdb_parquet_export';
import { QueryResultDownloadButton as QueryResultDownloadButtonView } from '@akohn/dashql-react/components/query_result/query_result_download_button';
import { useQueryResultTable } from '@akohn/dashql-react/hooks';
import { useComputeDatabase } from '../../connections/compute_connection_provider.js';
import { useDownloadFile } from '../../platform/file/file_downloader_hook.js';

// The download of a query result in the app (QueryResultDownloadButton of @akohn/dashql-react): the result table of
// the runtime, the file downloader of the app and the compute database that writes Parquet

export interface QueryResultDownloadButtonDependencies {
    useDownloadFile: typeof useDownloadFile;
    useComputeDatabase: typeof useComputeDatabase;
    exportArrowTableAsParquet: typeof exportArrowTableAsParquet;
}

const DEFAULT_DEPENDENCIES: QueryResultDownloadButtonDependencies = {
    useDownloadFile,
    useComputeDatabase,
    exportArrowTableAsParquet,
};

interface Props {
    query: QueryExecutionState;
    dependencies?: QueryResultDownloadButtonDependencies;
}

/// Download the result of a query as Arrow or Parquet
export function QueryResultDownloadButton({ query, dependencies = DEFAULT_DEPENDENCIES }: Props) {
    const downloadFile = dependencies.useDownloadFile();
    const computeDatabase = dependencies.useComputeDatabase();
    const resultTable = useQueryResultTable(query);
    const { exportArrowTableAsParquet: exportTable } = dependencies;
    const exportParquet = React.useMemo(() => {
        if (!supportsParquetExport(computeDatabase)) return null;
        return (table: arrow.Table) => exportTable(computeDatabase, table);
    }, [computeDatabase, exportTable]);
    return <QueryResultDownloadButtonView query={query} resultTable={resultTable} downloadFile={downloadFile} exportParquet={exportParquet} />;
}
