import * as React from 'react';
import { TableRendererData } from '../../model';
import { TableSchemaProvider } from '../table/table_schema_provider';
import { WiredTableViewer } from '../table/table_viewer';
import { CardFrame } from './card_frame';

interface Props {
    data: TableRendererData;
}

export const TableCardRenderer: React.FunctionComponent<Props> = (props: Props) => {
    return (
        <CardFrame title={props.data.v.table_name}>
            <TableSchemaProvider name={props.data.v.table_name}>
                <WiredTableViewer />
            </TableSchemaProvider>
        </CardFrame>
    );
};
