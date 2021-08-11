import * as React from 'react';
import * as core from '@dashql/core';
import { CardFrame } from './card_frame';

import DataGrid from './data_grid';

import ScanProvider = core.access.ScanProvider;

interface Props {
    card: core.model.CardSpecification;
    editable?: boolean;
}

export const TableRenderer: React.FC<Props> = (props: Props) => {
    const logger = core.model.useLogger();
    const dbMeta = core.model.useDatabaseMetadata();
    const db = core.useDatabaseClient();
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
                request={new core.access.ScanRequest().withRange(0, 1024)}
            >
                {(d, r) => <DataGrid table={table} data={d} requestData={r} />}
            </ScanProvider>
        </CardFrame>
    );
};
