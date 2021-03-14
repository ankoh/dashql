import * as webdb from '@dashql/webdb/dist/webdb_async';
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
    /// The width of the container
    width: number;
    /// The height of the container
    height: number;
    /// The error component
    errorComponent?: ((error: string) => React.ReactNode) | null;
    /// The in-flight component
    inFlightComponent?: ((query: string, queryOptions: webdb.QueryRunOptions) => React.ReactNode) | null;
    /// The children
    children: (result: proto.webdb.QueryResult) => React.ReactNode;
}

export class VizQueryProvider extends React.Component<Props> {
    runQuery(script: string, options: webdb.QueryRunOptions = {}) {
        console.log(script);
    }

    render() {
        const db = this.props.table;
        const query = this.props.data;
        const columnNames = query.columns.map(n => this.props.table.columnNames[n]);

        // Build select
        let orderBy = "";
        if (query.orderBy.length > 0) {
            orderBy = ` ORDER BY ${query.orderBy.map(o => columnNames[o]).join(',')}`;
        }

        // Build sampling expression
        let sampling = "";
        if (query.samplingMethod == model.SamplingMethod.RESERVOIR) {
            sampling = ` TABLESAMPLE RESERVOIR(${query.maxSampleSize} ROWS)`;
        }

        const script = `SELECT * FROM ${query.targetShort}${sampling}${orderBy}`;
        const partitions = (query.partitionBy.length > 0) ? query.partitionBy : undefined;

        return this.runQuery(script, {
            partitionBoundaries: partitions
        })
    }
}
