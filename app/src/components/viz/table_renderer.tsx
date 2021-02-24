import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../../model';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../../app_context';

import DataGrid from './data_grid';

import ScanProvider = core.access.ScanProvider;

interface Props {
    appContext: IAppContext;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
    targetQualified: string;
}

interface State {
    offset: number;
    limit: number;
}

export class TableRenderer extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { offset: 0, limit: 1024 };
    }

    /// Render the table
    public render() {
        const logger = this.props.appContext.platform!.logger;
        const db = this.props.appContext.platform!.database;
        const tableInfo = this.props.dbObjects.get(this.props.targetQualified);
        console.log(tableInfo);
        if (!tableInfo) {
            return <div />;
        }
        return (
            <ScanProvider logger={logger} database={db} targetName={tableInfo.nameShort}>
                {(data, dataProvider) => <DataGrid tableInfo={tableInfo} data={data} dataProvider={dataProvider} />}
            </ScanProvider>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dbObjects: state.core.planDatabaseTables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(TableRenderer));
