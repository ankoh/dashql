import * as React from 'react';
import * as model from '../model';
import * as duckdb from '@duckdb/duckdb-wasm';
import { Table } from 'apache-arrow/table';
import { QueryProvider, Query } from './query_provider';

// We run single-threaded at the moment, so deterministic output > true random temp names. (easy caching!)
const TMP_NAME = '__AM4__';

interface Props {
    /// The connection
    connection: duckdb.AsyncDuckDBConnection;
    /// The table info
    table: model.TableMetadata;
    /// The viz data query
    data: model.CardDataSource;
    /// The width of the container
    width: number;

    /// The error component
    errorComponent?: ((error: string) => React.ReactElement) | null;
    /// The in-flight component
    inFlightComponent?: ((query: Query) => React.ReactElement) | null;
    /// The children
    children: (result: Table) => React.ReactElement;
}

export const AM4Provider: React.FC<Props> = (props: Props) => {
    const canvasWidth = 500;
    const m5Config = props.data.am4Config;
    console.assert(!!m5Config, 'AM4 not configured!');

    // Get x and y attributes
    const xName = m5Config!.attributeX!;
    const yName = m5Config!.attributeY!;
    const xDomain = m5Config!.domainX!;
    const xDomainMin = xDomain[0];
    const xDomainMax = xDomain[1];
    const notX = props.table.columnNames.filter(n => n != xName);
    const notY = props.table.columnNames.filter(n => n != yName);
    const colID = (n: string) => props.table.columnNameMapping.get(n) || 0;

    // Based on the idea of M4.
    //
    // M4: A Visualization-Oriented Time Series Data Aggregation
    // Uwe Jugel, Zbigniew Jerzak, Gregor Hackenbroich, and Volker Markl. 2014.
    //
    // M4 has problems with many duplicates on y.
    // An almost distinct x is a reasonable assumption for time series but y may very well still contain many duplicates.
    // Therefore, M4 cannot make any guarantees about the ouput size which is very dangerous.
    // We pick up the idea from M4 to consider values on the y-axis but replace their join with
    // the aggregate functions arg_min and arg_max.
    //
    // We use a temporary table to ensure that we do the aggregation only once.
    // (At the time of writing, DuckDB does not share common subtrees between UNION ALL).
    //
    const binExpr = `round(${canvasWidth}*(${xName}-${xDomainMin})/(${xDomainMax}-${xDomainMin}))`;

    // Packs aggreagte and preserves all other columns.
    // E.g.: min(x) as _p0_0, arg_min(y, x) as _p0_1, arg_min(z, x) as _p0_2
    const agg = (point: number, func: string, by: string, preserve: string[]) =>
        `${func}(${by}) as _p${point}_${colID(by)}, ${preserve
            .map(c => `arg_${func}(${c}, ${by}) as _p${point}_${colID(c)}`)
            .join(', ')}`;
    const aggs = [
        agg(0, 'min', xName, notX),
        agg(1, 'max', xName, notX),
        agg(2, 'min', yName, notY),
        agg(3, 'max', yName, notY),
    ].join(',\n');

    // Unpacks aggregated columns
    // E.g.: _p0_0 as x, _p0_1 as y, _p0_2 as z
    const unpack = (point: number) => props.table.columnNames.map(n => `_p${point}_${colID(n)} as ${n}`).join(', ');

    const before = `CREATE TEMPORARY TABLE ${TMP_NAME} AS (
    SELECT ${binExpr} as k,
${aggs}
    FROM ${props.table.nameQualified} GROUP BY k
);  `;

    const data = `SELECT * FROM (
    SELECT ${unpack(0)} FROM ${TMP_NAME}
    UNION ALL
    SELECT ${unpack(1)} FROM ${TMP_NAME}
    UNION ALL
    SELECT ${unpack(2)} FROM ${TMP_NAME}
    UNION ALL
    SELECT ${unpack(3)} FROM ${TMP_NAME}
) combined ORDER BY ${xName}
    `;
    const after = `DROP TABLE IF EXISTS ${TMP_NAME}`;

    return (
        <QueryProvider connection={props.connection} query={{ before, data, after }}>
            {result => props.children(result)}
        </QueryProvider>
    );
};
