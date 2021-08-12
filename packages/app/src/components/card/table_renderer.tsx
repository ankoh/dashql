import * as React from 'react';
import * as model from '../../model';
import * as access from '../../access';
import { CardFrame } from './card_frame';
import { useDatabaseClient } from '../../database_client';

import DataGrid from './data_grid';

import ScanProvider = access.ScanProvider;

interface Props {
    card: model.CardSpecification;
    editable?: boolean;
}

export const TableRenderer: React.FC<Props> = (props: Props) => {
    const logger = model.useLogger();
    const dbMeta = model.useDatabaseMetadata();
    const db = useDatabaseClient();
    const target = props.card.dataSource!.targetQualified;
    const data = props.card.dataSource!;
    const table = dbMeta.tables.get(data.targetQualified);
    if (!table) {
        return <div />;
    }
    return (
        <CardFrame title={props.card.title || target} controls={props.editable}>
            <ScanProvider
                logger={logger}
                database={db}
                targetName={table.nameQualified}
                request={new access.ScanRequest().withRange(0, 1024)}
            >
                {(d, r) => <DataGrid table={table} data={d} requestData={r} />}
            </ScanProvider>
        </CardFrame>
    );
};
