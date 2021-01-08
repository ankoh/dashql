import * as Immutable from 'immutable';
import * as React from 'react';
import * as proto from '@dashql/proto';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as model from '../../model';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../../app_context';

import DataGrid from './data_grid';

import PartialScanProvider = core.access.PartialScanProvider;

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
    _updateRange = this.updateRange.bind(this);

    constructor(props: Props) {
        super(props);
        this.state = { offset: 0, limit: 1024 };
    }

    /// Update the range
    public updateRange(range: core.access.ScanRange) {
        this.setState({
            ...this.state,
            offset: range.offset,
            limit: range.limit,
        });
    }

    /// Render the table
    public render() {
        const db = this.props.appContext.platform!.database;
        const tableInfo = this.props.dbObjects.get(this.props.viz.nameQualified);
        if (!tableInfo) {
            return <div />;
        } else {
            return (
                <PartialScanProvider database={db} targetName={tableInfo.nameShort} offset={this.state.offset} limit={this.state.limit}>
                    {data => <DataGrid tableInfo={tableInfo} data={data} dataProvider={this._updateRange} />}
                </PartialScanProvider>
            );
        }
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dbObjects: state.core.planDatabaseTables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(TableChart));
