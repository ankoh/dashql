import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as React from 'react';
import * as platform from '../platform';
import * as model from '../model';
import * as arrow from 'apache-arrow';
import { QueryProvider } from './query_provider';

interface Props {
    /// The log manager
    logger: duckdb.Logger;
    /// The database manager
    database: platform.DatabaseManager;
    /// The table info
    table: model.Table;
    /// The viz data query
    data: model.CardDataSource;
    /// The error component
    errorComponent?: ((error: string) => React.ReactNode) | null;
    /// The in-flight component
    inFlightComponent?: ((query: string) => React.ReactNode) | null;
    /// The children
    children: (result: arrow.Table) => React.ReactNode;
}

export const SampleProvider: React.FunctionComponent<Props> = (props: Props) => {
    // Build select
    let orderBy = '';
    if (props.data.orderBy && props.data.orderBy.length > 0) {
        orderBy = ` ORDER BY ${props.data.orderBy.map(o => o.field + ' ' + (o.order || '')).join(',')}`;
    }
    const sampling = ` TABLESAMPLE RESERVOIR(${props.data.sampleSize} ROWS)`;

    const script = `SELECT * FROM ${props.table.nameQualified}${sampling}${orderBy}`;
    return (
        <QueryProvider logger={props.logger} database={props.database} query={{ data: script }}>
            {result => props.children(result)}
        </QueryProvider>
    );
};
