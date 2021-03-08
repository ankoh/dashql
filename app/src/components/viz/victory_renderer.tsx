import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../../model';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../../app_context';
import { AutoSizer } from '../../util/autosizer';
import { VizCard } from './viz_card';
import VictoryChartSimple from './victory_chart_simple';

import styles from './victory_renderer.module.css';

interface Props {
    appContext: IAppContext;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
    vizInfo: core.model.VizInfo;
}

export class VictoryRenderer extends React.Component<Props> {
    public render() {
        const targetQualified = this.props.vizInfo.nameQualified;
        const tableInfo = this.props.dbObjects.get(targetQualified);
        if (!tableInfo) {
            return <div />;
        }
        return (
            <VizCard title={this.props.vizInfo.title}>
                <AutoSizer>
                    {({ width, height }) => (
                        <VictoryChartSimple
                            appContext={this.props.appContext}
                            tableInfo={tableInfo}
                            vizInfo={this.props.vizInfo}
                            width={width}
                            height={height}
                        />
                    )}
                </AutoSizer>
            </VizCard>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dbObjects: state.core.planDatabaseTables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(VictoryRenderer));
