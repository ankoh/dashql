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
        const canvasWidth = 1000;

        // Get x and y attributes
        console.assert(query.xAttributes.length == 1, "M4 currently requires a single x attribute");
        console.assert(query.yAttributes.length == 1, "M4 currently requires a single y attribute");
        const y = query.columns[query.yAttributes[0]];
        const x = query.columns[query.xAttributes[0]];

        // Get x domain
        const xMin = db.statistics.get(model.buildTableStatisticsKey(model.TableStatisticsType.MINIMUM_VALUE, x));
        const xMax = db.statistics.get(model.buildTableStatisticsKey(model.TableStatisticsType.MAXIMUM_VALUE, x));
        console.assert(!!xMin, "M4 requires a pre-fetched minimum value of x");
        console.assert(!!xMax, "M4 requires a pre-fetched maximum value of x");

        // Build binning expression
        const xMinStr = xMin![0].printScript();
        const xMaxStr = xMax![0].printScript();
        const keyExpr = `round(${canvasWidth}*(${columnNames[x]}-${xMinStr})/(${xMaxStr}-${xMinStr}))`;

        // Build query.
        // Directly taken from here:
        //
        // M4: A Visualization-Oriented Time Series Data Aggregation
        // Uwe Jugel, Zbigniew Jerzak, Gregor Hackenbroich, and Volker Markl. 2014.
        //
        const script = `
SELECT * FROM ${query.targetShort}, (
SELECT ${keyExpr} as k,
        min(${columnNames[y]}) as _y_min, max(${columnNames[y]}) as _y_max,
        min(${columnNames[x]}) as _x_min, max(${columnNames[x]}) as _x_max,
FROM ${query.targetShort} GROUP BY k) as tmp
WHERE k = ${keyExpr}
AND   (${columnNames[y]} = _y_min OR ${columnNames[y]} = _y_max OR
    ${columnNames[x]} = _x_min OR ${columnNames[x]} = _x_max)
        `;

        return (
            <QueryProvider
                logger={this.props.logger}
                database={this.props.database}
                query={script}
                queryOptions={options}
            >
                {result => this.props.children.bind(this)(result)}
            </QueryProvider>
        );
    }
}
