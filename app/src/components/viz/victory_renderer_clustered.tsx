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

import TypeModifier = core.proto.syntax.VizComponentTypeModifier;
import ComponentType = core.proto.syntax.VizComponentType;
import { VizDataQuery } from '@dashql/core/dist/types/model';

interface Props {
    appContext: IAppContext;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
    vizInfo: core.model.VizInfo;
}

export class VictoryChartClustered extends React.Component<Props> {
    public renderComponent(i: number, c: core.model.VizComponentSpec, partitions: webdb.RowProxy[][]) {
        const targetQualified = this.props.vizInfo.nameQualified;
        const table = this.props.dbObjects.get(targetQualified)!;
        const dataView = c.dataView;
        const dataQuery = this.props.vizInfo.dataQuery;

        //const xs = dataView.x.map(i => table.columnNames[i]);
        //const ys = dataView.y.map(i => table.columnNames[i]);

        /// Translate component
        const translate = (rows: webdb.RowProxy[], x?: string, y?: string): React.ReactNode => {
            const dataProps = {
                data: rows,
                x,
                y,
            };
            switch (c.type) {
                case ComponentType.AREA:
                    return <vy.VictoryArea key={i} style={c.styles} {...dataProps} />;
                case ComponentType.BAR:
                    return <vy.VictoryBar key={i} style={c.styles} {...dataProps} />;
                case ComponentType.CANDLESTICK:
                    return <vy.VictoryCandlestick key={i} style={c.styles} {...dataProps} />;
                case ComponentType.ERROR_BAR:
                    return <vy.VictoryErrorBar key={i} style={c.styles} {...dataProps} />;
                case ComponentType.HISTOGRAM:
                    return <vy.VictoryHistogram key={i} style={c.styles} {...dataProps} />;
                case ComponentType.LINE:
                    return <vy.VictoryLine key={i} style={c.styles} {...dataProps} />;
                case ComponentType.SCATTER:
                    return <vy.VictoryScatter key={i} style={c.styles} {...dataProps} />;
                default:
                    return <div />;
            }
        };

        // Is same cluster?
        const sameCluster = (l: webdb.RowProxy[], r: webdb.RowProxy[]): boolean => {
            for (const a of dataQuery.clusterBy) {
                if (l[0].__attribute__(a) != r[0].__attribute__(a)) return false;
            }
            return true;
        };

        // Collect all partitions that belong to a cluster
        let nodes: React.ReactNode[] = [];
        while (i < partitions.length) {
            let cluster: webdb.RowProxy[][] = [partitions[i]];
            for (++i; i < partitions.length && sameCluster(cluster[0], partitions[i]); ++i) {
                cluster.push(partitions[i]);
            }

            let stack: React.ReactNode = (
                <vy.VictoryStack>
                    {cluster.map(p => translate(p))}
                </vy.VictoryStack>
            );
            nodes.push(stack);
        }
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
