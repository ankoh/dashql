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
    /// The error component
    errorComponent?: ((error: string) => React.ReactNode) | null;
    /// The in-flight component
    inFlightComponent?: ((query: string, queryOptions: webdb.QueryRunOptions) => React.ReactNode) | null;
    /// The children
    children: (result: proto.webdb.QueryResult) => React.ReactNode;
}

export const M4Provider: React.FunctionComponent<Props> = (props: Props) => {
    const canvasWidth = 1000;
    const m4Config = props.data.m4Config;
    console.assert(!!m4Config, 'M4 not configured!');

    // Get x and y attributes
    const xName = m4Config!.attributeX!;
    const yName = m4Config!.attributeY!;
    const xDomain = m4Config?.domainX!;
    const xDomainMin = xDomain[0];
    const xDomainMax = xDomain[1];

    // Build query.
    // Directly taken from here:
    //
    // M4: A Visualization-Oriented Time Series Data Aggregation
    // Uwe Jugel, Zbigniew Jerzak, Gregor Hackenbroich, and Volker Markl. 2014.
    //
    const bins = `round(${canvasWidth}*(${xName}-${xDomainMin})/(${xDomainMax}-${xDomainMin}))`;
    const script = `
SELECT * FROM ${props.table.tableNameShort}, (
    SELECT ${bins} as k,
        min(${yName}) as _y_min, max(${yName}) as _y_max,
        min(${xName}) as _x_min, max(${xName}) as _x_max,
    FROM ${props.table.tableNameShort} GROUP BY k) as tmp
WHERE k = ${bins}
AND (${yName} = _y_min OR ${yName} = _y_max OR ${xName} = _x_min OR ${xName} = _x_max)
    `;

    return (
        <QueryProvider logger={props.logger} database={props.database} query={script}>
            {result => props.children.bind(this)(result)}
        </QueryProvider>
    );
};
