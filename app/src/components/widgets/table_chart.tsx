import * as Immutable from 'immutable';
import * as React from 'react';
import * as proto from '@dashql/proto';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as model from '../../model';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../../app_context';

import DataGrid from './data_grid';

import ScanProvider = core.access.ScanProvider;

import styles from './table_chart.module.css';

interface Props {
    appContext: IAppContext;
    viz: core.model.VizInfo;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
}

interface State {
    offset: number;
    limit: number;
}

export class TableChart extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { offset: 0, limit: 1024 };
    }

    /// Render the table
    public render() {
        const log = this.props.appContext.platform!.log;
        const db = this.props.appContext.platform!.database;
        const tableInfo = this.props.dbObjects.get(this.props.viz.nameQualified);
        if (!tableInfo) {
            return <div />;
        } else {
            return (
                <ScanProvider log={log} database={db} targetName={tableInfo.nameShort}>
                    {(data, dataProvider) => <DataGrid tableInfo={tableInfo} data={data} dataProvider={dataProvider} />}
                </ScanProvider>
            );
        }
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dbObjects: state.core.planDatabaseTables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(TableChart));
