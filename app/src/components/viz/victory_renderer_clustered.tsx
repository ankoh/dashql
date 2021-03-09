import * as Immutable from 'immutable';
import * as React from 'react';
import * as model from '../../model';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import { connect } from 'react-redux';
import { VizCard } from './viz_card';
import { AutoSizer } from '../../util/autosizer';
import { IAppContext, withAppContext } from '../../app_context';
import * as vy from 'victory';

interface Props {
    appContext: IAppContext;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
    vizInfo: core.model.VizInfo;
}

export class VictoryChartClustered extends React.Component<Props> {
    public renderComponent(i: number, c: core.model.VizComponentSpec, partitions: webdb.RowProxy[][]) {
        console.log(partitions);
    }

    public render() {
        const targetQualified = this.props.vizInfo.nameQualified;
        const table = this.props.dbObjects.get(targetQualified);
        if (!table) {
            return <div />;
        }
        return (
            <VizCard title={this.props.vizInfo.title}>
                <core.access.VizQueryProvider
                    logger={this.props.appContext.platform!.logger}
                    database={this.props.appContext.platform!.database}
                    table={table}
                    query={this.props.vizInfo.dataQuery}
                >
                    {result => (
                        <core.access.ProxyPartitionsProvider result={result}>
                            {partitions => (
                                <AutoSizer>
                                    {({ width, height }) => (
                                        <vy.VictoryChart
                                            style={{
                                                parent: { width, height },
                                            }}
                                            width={width}
                                            height={height}
                                            padding={{
                                                top: 16,
                                                left: 36,
                                                right: 20,
                                                bottom: 36,
                                            }}
                                        >
                                            {this.props.vizInfo.components.map((c, i) =>
                                                this.renderComponent(i, c, partitions),
                                            )}
                                        </vy.VictoryChart>
                                    )}
                                </AutoSizer>
                            )}
                        </core.access.ProxyPartitionsProvider>
                    )}
                </core.access.VizQueryProvider>
            </VizCard>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dbObjects: state.core.planDatabaseTables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(VictoryChartClustered));
