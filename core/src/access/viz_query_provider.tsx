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
    render() {
        // Collect query information
        const query = this.props.data;
        const columnNames = query.columns.map(n => this.props.table.columnNames[n]);
        const selectText = columnNames.join(',');
        let orderByText = "";
        let sampleSize = 10000;
        if (query.orderBy.length > 0) {
            const orderByList = query.orderBy.map(o => columnNames[o]).join(',');
            orderByText = ` ORDER BY ${orderByList}`;
        }
        if (query.partitionBy.length > 0) {
            sampleSize = 10000; // XXX smarter decisions
        }
        const tableSampleText = ` TABLESAMPLE RESERVOIR(${sampleSize} ROWS)`;

        // Build query script
        const script = `SELECT ${selectText} FROM ${query.targetShort}${tableSampleText}${orderByText}`;
        const partitionBoundaries = (query.partitionBy.length > 0) ? query.partitionBy : undefined;

        console.log(this.props.width);

        return (
            <QueryProvider
                logger={this.props.logger}
                database={this.props.database}
                query={script}
                queryOptions={{
                    partitionBoundaries: partitionBoundaries
                }}
            >
                {result => this.props.children.bind(this)(result)}
            </QueryProvider>
        );
    }
}
