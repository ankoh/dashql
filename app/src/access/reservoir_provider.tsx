import * as React from 'react';
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

    /// The children
    children?: React.ReactElement | React.ReactElement[];
}

export const ReservoirProvider: React.FC<Props> = (props: Props) => {
    let orderBy = '';
    if (props.orderBy && props.orderBy.length > 0) {
        orderBy = ` ORDER BY ${props.orderBy.map(o => o.field + ' ' + (o.orderBy || '')).join(',')}`;
    }
    const sampling = ` TABLESAMPLE RESERVOIR(${props.sampleSize} ROWS)`;
    const script = `SELECT * FROM ${props.table.table_name}${sampling}${orderBy}`;
    return <QueryProvider query={{ data: script }}>{props.children}</QueryProvider>;
};
