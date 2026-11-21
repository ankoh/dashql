import * as React from 'react';
import type * as arrow from 'apache-arrow';

import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import { exportArrowTableAsParquet } from '@akohn/dashql/platform/hyperdb/hyperdb_parquet_export';
import { QueryResultDownloadButton as QueryResultDownloadButtonView } from '@akohn/dashql-react/components/query_result/query_result_download_button';
import { useComputeDatabase } from '@akohn/dashql-react/hooks';

// The download of a query result in the app (QueryResultDownloadButton of @akohn/dashql-react): the compute database of
// the app writes Parquet

interface Props {
    model: QueryModel;
}

/// Download the result of a query as Arrow or Parquet
export function QueryResultDownloadButton({ model }: Props) {
    const computeDatabase = useComputeDatabase();
    const exportParquet = React.useMemo(() => {
        if (computeDatabase == null) return null;
        return (table: arrow.Table) => exportArrowTableAsParquet(computeDatabase, table);
    }, [computeDatabase]);
    return <QueryResultDownloadButtonView model={model} exportParquet={exportParquet} />;
}
