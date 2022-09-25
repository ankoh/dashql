import * as React from 'react';
import { Table } from 'apache-arrow/table';
import { QueryProvider } from './query_provider';
import { TableMetadata } from '../model/table_metadata';

export type SortOrder = 'ascending' | 'descending';
export interface SortField {
    /// The field
    field: string;
    /// The order
    orderBy?: SortOrder;
}

export interface SortFields {
    /// The field
    field: string[];
    /// The order
    orderBy?: SortOrder[];
}

interface Props {
    /// The table info
    table: TableMetadata;
    /// The sample size
    sampleSize: number;
    /// The viz data query
    orderBy?: SortField[];

    /// The error component
    errorComponent?: ((error: string) => React.ReactElement) | null;
    /// The in-flight component
    inFlightComponent?: ((query: string) => React.ReactElement) | null;
    /// The children
    children: (result: Table) => React.ReactElement;
}

export const SampleProvider: React.FC<Props> = (props: Props) => {
    let orderBy = '';
    if (props.orderBy && props.orderBy.length > 0) {
        orderBy = ` ORDER BY ${props.orderBy.map(o => o.field + ' ' + (o.orderBy || '')).join(',')}`;
    }
    const sampling = ` TABLESAMPLE RESERVOIR(${props.sampleSize} ROWS)`;
    const script = `SELECT * FROM ${props.table.table_name}${sampling}${orderBy}`;
    return <QueryProvider query={{ data: script }}>{result => props.children(result)}</QueryProvider>;
};
