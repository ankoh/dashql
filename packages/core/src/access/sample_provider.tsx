import * as webdb from '@dashql/webdb/dist/webdb-async.module';
import * as React from 'react';
import * as platform from '../platform';
import * as model from '../model';
import * as proto from '@dashql/proto';
import { QueryProvider } from './query_provider';

interface Props {
    /// The log manager
    logger: webdb.Logger;
    /// The database manager
    database: platform.DatabaseManager;
    /// The table info
    table: model.DatabaseTableInfo;
    /// The viz data query
    data: model.VizDataSource;
    /// The error component
    errorComponent?: ((error: string) => React.ReactNode) | null;
    /// The in-flight component
    inFlightComponent?: ((query: string, queryOptions: webdb.QueryRunOptions) => React.ReactNode) | null;
    /// The children
    children: (result: proto.webdb.QueryResult) => React.ReactNode;
}

export const SampleProvider: React.FunctionComponent<Props> = (props: Props) => {
    const db = props.table;

    // Build select
    let orderBy = '';
    if (props.data.orderBy && props.data.orderBy.length > 0) {
        orderBy = ` ORDER BY ${props.data.orderBy.map(o => o.field + ' ' + (o.order || '')).join(',')}`;
    }
    let sampling = ` TABLESAMPLE RESERVOIR(${props.data.sampleSize} ROWS)`;

    const script = `SELECT * FROM ${props.table.tableNameShort}${sampling}${orderBy}`;
    return (
        <QueryProvider logger={props.logger} database={props.database} query={{ data: script }}>
            {result => props.children.bind(this)(result)}
        </QueryProvider>
    );
};
