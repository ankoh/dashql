import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../../model';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../../app_context';
import { CardFrame } from './card_frame';

import DataGrid from './data_grid';

import ScanProvider = core.access.ScanProvider;

interface Props {
    appContext: IAppContext;
    tables: Immutable.Map<string, core.model.Table>;
    card: core.model.Card;
    editable?: boolean;
}

export class TableRenderer extends React.Component<Props> {
    constructor(props: Props) {
        super(props);
    }

    /// Render the table
    public render(): React.ReactElement {
        const logger = this.props.appContext.platform!.logger;
        const db = this.props.appContext.platform!.database;
        const data = this.props.card.dataSource!;
        const table = this.props.tables.get(data.targetQualified);
        if (!table) {
            return <div />;
        }
        const targetShort = table.tableNameShort;
        return (
            <CardFrame title={this.props.card.title || 'Some Title'} controls={this.props.editable}>
                <ScanProvider
                    logger={logger}
                    database={db}
                    targetName={targetShort}
                    request={new core.access.ScanRequest().withRange(0, 1024)}
                >
                    {(d, r) => <DataGrid table={table} data={d} requestData={r} />}
                </ScanProvider>
            </CardFrame>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    tables: state.core.planState.tables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(TableRenderer));
