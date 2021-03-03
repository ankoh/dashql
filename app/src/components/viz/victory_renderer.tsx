import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb';
import * as model from '../../model';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../../app_context';
import { AutoSizer } from '../../util/autosizer';
import { VizCard } from './viz_card';
import { VictoryChart, VictoryAxis, VictoryLine, VictoryScatter, VictoryTheme } from 'victory';

import QueryProvider = core.access.QueryProvider;

import styles from './victory_renderer.module.css';

interface ChartComposerProps {
    logger: webdb.Logger;
    vizInfo: core.model.VizInfo;
    tableInfo: core.model.DatabaseTableInfo;
    queryResults: Immutable.Map<number, core.access.QueryData> | null;
    requestQuery: (r: core.access.QueryRequest) => void;
}

class ChartComposer extends React.Component<ChartComposerProps> {
    render() {
        const mockData = [
            { x: 1, y: 2 },
            { x: 2, y: 3 },
            { x: 3, y: 5 },
            { x: 4, y: 4 },
            { x: 5, y: 7 },
        ];
        return (
            <AutoSizer>
                {({ height, width }) => (
                    <VictoryChart
                        style={{
                            parent: {
                                width: width,
                                height: height,
                            },
                        }}
                        width={width}
                        height={height}
                        domain={[0, 10]}
                        padding={{
                            top: 20,
                            left: 40,
                            right: 30,
                            bottom: 40,
                        }}
                        theme={VictoryTheme.material}
                    >
                        <VictoryAxis />
                        <VictoryAxis dependentAxis />
                        <VictoryLine data={mockData} />
                    </VictoryChart>
                )}
            </AutoSizer>
        );
    }
}

interface Props {
    appContext: IAppContext;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
    vizInfo: core.model.VizInfo;
}

interface State {
    rows: webdb.RowProxy[],
}

export class VictoryRenderer extends React.Component<Props> {
    public render() {
        const logger = this.props.appContext.platform!.logger;
        const db = this.props.appContext.platform!.database;
        const targetQualified = this.props.vizInfo.nameQualified;
        const tableInfo = this.props.dbObjects.get(targetQualified);
        if (!tableInfo) {
            return <div />;
        }
        return (
            <VizCard title={this.props.vizInfo.title}>
                <QueryProvider logger={logger} database={db}>
                    {(queryResults, requestQuery) => (
                        <ChartComposer
                            logger={logger}
                            vizInfo={this.props.vizInfo}
                            tableInfo={tableInfo}
                            queryResults={queryResults}
                            requestQuery={requestQuery}
                        />
                    )}
                </QueryProvider>
            </VizCard>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dbObjects: state.core.planDatabaseTables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(VictoryRenderer));
