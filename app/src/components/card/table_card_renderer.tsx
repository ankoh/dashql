import * as React from 'react';
import { TableRendererData } from '../../model';
import { ScanningTableViewer } from '../table/table_viewer';
import { CardFrame } from './card_frame';

interface Props {
    data: TableRendererData;
}

export const TableCardRenderer: React.FunctionComponent<Props> = (props: Props) => {
    const table = props.data.v.table;
    return (
        <CardFrame title={table.table_name}>
            <ScanningTableViewer table={table} />
        </CardFrame>
    );
};
