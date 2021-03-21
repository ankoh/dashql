import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../../model';
import { connect } from 'react-redux';
import { VizCard } from './viz_card';
import { IAppContext, withAppContext } from '../../app_context';

import DataGrid from './data_grid';

import ScanProvider = core.access.ScanProvider;

interface Props {
    appContext: IAppContext;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
    vizInfo: core.model.VizInfo;
    editable?: boolean;
}

export class TableRenderer extends React.Component<Props> {
    constructor(props: Props) {
        super(props);
    }

    /// Render the table
    public render() {
        const logger = this.props.appContext.platform!.logger;
        const db = this.props.appContext.platform!.database;
        const table = this.props.dbObjects.get(this.props.vizInfo.dataSource.targetQualified);
        if (!table) {
            return <div />;
        }
        const targetShort = table.tableNameShort;
        const targetQualified = table.tableNameQualified;
        return (
            <VizCard title={this.props.vizInfo.title || `Table ${targetShort}`} controls={this.props.editable}>
                <ScanProvider logger={logger} database={db} targetName={targetShort} request={new core.access.ScanRequest().withRange(0, 1024)}>
                    {(data, requestData) => <DataGrid tableInfo={table} data={data} requestData={requestData} />}
                </ScanProvider>
            </VizCard>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dbObjects: state.core.planDatabaseTables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(TableRenderer));
