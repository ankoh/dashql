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

export class VictoryChartGrouped extends React.Component<Props> {
    public renderComponent(i: number, c: core.model.VizComponentSpec, partitions: webdb.RowProxy[][]) {

    }

    public render() {
        const targetQualified = this.props.vizInfo.nameQualified;
        const tableInfo = this.props.dbObjects.get(targetQualified);
        if (!tableInfo) {
            return <div />;
        }
        const query = this.props.vizInfo.query;
        if (!query) {
            console.error("missing viz query");
            return <div />;
        }
        return (
            <VizCard title={this.props.vizInfo.title}>
                <AutoSizer>
                    {({ width, height }) => (
                        <core.access.QueryProvider
                            logger={this.props.appContext.platform!.logger}
                            database={this.props.appContext.platform!.database}
                            query={query.script}
                            queryOptions={{
                                partitionBoundaries: query.keyColumns
                            }}
                        >
                            {(result) => (
                                <core.access.ProxyPartitionsProvider result={result}>
                                    {(_result, partitions) => (
                                        <vy.VictoryChart
                                            style={{
                                                parent: {
                                                    width: width,
                                                    height: height,
                                                },
                                            }}
                                            width={width}
                                            height={height}
                                            padding={{
                                                top: 16,
                                                left: 36,
                                                right: 20,
                                                bottom: 36,
                                            }}
                                            theme={vy.VictoryTheme.material}
                                        >
                                            {this.props.vizInfo.components.map((c, i) => this.renderComponent(i, c, partitions))}
                                        </vy.VictoryChart>
                                    )}
                                </core.access.ProxyPartitionsProvider>
                            )}
                        </core.access.QueryProvider>
                    )}
                </AutoSizer>
            </VizCard>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dbObjects: state.core.planDatabaseTables
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(VictoryChartGrouped));
