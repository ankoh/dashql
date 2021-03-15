import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as React from 'react';
import * as platform from '../platform';
import * as model from '../model';
import * as proto from '@dashql/proto';
import { QueryProvider, Query } from './query_provider';

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
    inFlightComponent?: ((query: Query) => React.ReactNode) | null;
    /// The children
    children: (result: proto.webdb.QueryResult) => React.ReactNode;
}

export const M5Provider: React.FunctionComponent<Props> = (props: Props) => {
    const canvasWidth = 1000;
    const m5Config = props.data.m5Config;
    console.assert(!!m5Config, 'M5 not configured!');

    // Get x and y attributes
    const xName = m5Config!.attributeX!;
    const yName = m5Config!.attributeY!;
    const xDomain = m5Config?.domainX!;
    const xDomainMin = xDomain[0];
    const xDomainMax = xDomain[1];

    // Build query.
    // Based on the idea of M4
    //
    // M4: A Visualization-Oriented Time Series Data Aggregation
    // Uwe Jugel, Zbigniew Jerzak, Gregor Hackenbroich, and Volker Markl. 2014.
    //
    const binExpr = `round(${canvasWidth}*(${xName}-${xDomainMin})/(${xDomainMax}-${xDomainMin}))`;
    const tmp = "sometemp";
    const before = `
CREATE TEMPORARY TABLE ${tmp} AS (
    SELECT ${binExpr} as k,
        min(${xName}) as _xmin_x, arg_min(${yName}, ${xName}) as _xmin_y,
        max(${xName}) as _xmax_x, arg_max(${yName}, ${xName}) as _xmax_y,
        min(${yName}) as _ymin_y, arg_min(${xName}, ${yName}) as _ymin_x,
        max(${yName}) as _ymax_y, arg_max(${xName}, ${yName}) as _ymax_x
    FROM ${props.table.tableNameShort} GROUP BY k
);  `;
    const data = `
SELECT * FROM (
    SELECT _xmin_x AS ${xName}, _xmin_y AS ${yName} FROM ${tmp}
    UNION ALL
    SELECT _xmax_x AS ${xName}, _xmax_y AS ${yName} FROM ${tmp}
    UNION ALL
    SELECT _ymin_x AS ${xName}, _ymin_y AS ${yName} FROM ${tmp}
    UNION ALL
    SELECT _ymax_x AS ${xName}, _ymax_y AS ${yName} FROM ${tmp}
) combined ORDER BY ${xName}
    `;
    const after = `DROP TABLE ${tmp}`;

    return (
        <QueryProvider logger={props.logger} database={props.database} query={{ before, data, after }}>
            {result => props.children.bind(this)(result)}
        </QueryProvider>
    );
};
