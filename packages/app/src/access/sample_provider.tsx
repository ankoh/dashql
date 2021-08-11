import * as React from 'react';
import * as model from '../model';
import * as arrow from 'apache-arrow';
import { QueryProvider } from './query_provider';

interface Props {
    /// The table info
    table: model.TableMetadata;
    /// The viz data query
    data: model.CardDataSource;

    /// The error component
    errorComponent?: ((error: string) => React.ReactElement) | null;
    /// The in-flight component
    inFlightComponent?: ((query: string) => React.ReactElement) | null;
    /// The children
    children: (result: arrow.Table) => React.ReactElement;
}

export const SampleProvider: React.FC<Props> = (props: Props) => {
    // Build select
    let orderBy = '';
    if (props.data.orderBy && props.data.orderBy.length > 0) {
        orderBy = ` ORDER BY ${props.data.orderBy.map(o => o.field + ' ' + (o.order || '')).join(',')}`;
    }
    const sampling = ` TABLESAMPLE RESERVOIR(${props.data.sampleSize} ROWS)`;

    const script = `SELECT * FROM ${props.table.nameQualified}${sampling}${orderBy}`;
    return <QueryProvider query={{ data: script }}>{result => props.children(result)}</QueryProvider>;
};
