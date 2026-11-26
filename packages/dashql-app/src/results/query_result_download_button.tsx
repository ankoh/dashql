import * as React from 'react';

import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import { exportParquet } from '@akohn/dashql/platform/hyperdb/hyperdb_parquet_export';
import { QueryResultDownloadButton as QueryResultDownloadButtonView } from '@akohn/dashql-react/components/query_result/query_result_download_button';
import { useComputeDatabase, useOptionalRuntime } from '@akohn/dashql-react/hooks';

// The download of a query result in the app (QueryResultDownloadButton of @akohn/dashql-react): the compute database of
// the app writes Parquet, Hyper copies the rows of the result from the data frame of its computation into the file

interface Props {
    model: QueryModel;
}

/// Download the result of a query as Arrow or Parquet
export function QueryResultDownloadButton({ model }: Props) {
    const computeDatabase = useComputeDatabase();
    const runtime = useOptionalRuntime();
    const exportResultParquet = React.useMemo(() => {
        if (computeDatabase == null || runtime == null) return null;
        return (tableId: number) => exportParquet(computeDatabase, path => runtime.exportResultParquet(tableId, path));
    }, [computeDatabase, runtime]);
    return <QueryResultDownloadButtonView model={model} exportParquet={exportResultParquet} />;
}
