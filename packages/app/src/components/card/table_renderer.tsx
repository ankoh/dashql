import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../../model';
import { useSelector } from 'react-redux';
import { IAppContext, withAppContext } from '../../app_context';
import { CardFrame } from './card_frame';

import DataGrid from './data_grid';

import ScanProvider = core.access.ScanProvider;

interface Props {
    appContext: IAppContext;
    card: core.model.CardSpecification;
    editable?: boolean;
}

const InnerTableRenderer: React.FC<Props> = (props: Props) => {
    const planState = useSelector((state: model.AppState) => state.core.planState);
    const target = props.card.dataSource!.targetQualified;
    const logger = props.appContext.platform!.logger;
    const db = props.appContext.platform!.database;
    const data = props.card.dataSource!;
    const table = core.model.resolveTableByName(planState, data.targetQualified);
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

export const TableRenderer = withAppContext(InnerTableRenderer);
