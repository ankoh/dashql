import * as Immutable from 'immutable';
import * as React from 'react';
import * as proto from '@dashql/proto';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as model from '../../model';
import { connect } from 'react-redux';

import DataGrid from './data_grid';

import styles from './table_chart.module.css';

type Props = {
    viz: core.model.VizData;
    dbObjects: Immutable.Map<string, core.model.DatabaseTable>;
};

export class TableChart extends React.Component<Props> {

    /// Render the table
    public render() {
        const data = this.props.dbObjects.get(this.props.viz.nameQualified);
        if (!data) {
            return <div />;
        } else {
            return <DataGrid data={data} />;
        }
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dbObjects: state.core.planDatabaseTables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(TableChart);
