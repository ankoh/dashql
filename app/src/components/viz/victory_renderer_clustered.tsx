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

interface ClusteredChartsProps {
    /// The partitions
    partitions: webdb.RowProxy[][];
    /// The cluster columns
    clusterBy: number[];
    /// The children
    children: (partitions: webdb.RowProxy[][], clusterId: number) => React.ReactNode | React.ReactNode[];
}

interface ClusteredChartsState {
    /// The partitions
    partitions: webdb.RowProxy[][];
    /// The cluster columns
    clusterBy: number[];
    /// The clustered partitions
    clusteredPartitions: webdb.RowProxy[][][];
}

export class ClusteredCharts extends React.Component<ClusteredChartsProps, ClusteredChartsState> {
    public static getDerivedStateFromProps(nextProps: ClusteredChartsProps, prevState?: ClusteredChartsState) {
        // Nothing to do?
        if (prevState && prevState.partitions == nextProps.partitions && prevState.clusterBy == nextProps.clusterBy) {
            return prevState;
        }

        // Helper to compare cluster key?
        const sameCluster = (l: webdb.RowProxy[], r: webdb.RowProxy[]): boolean => {
            for (const a of nextProps.clusterBy) {
                if (l[0].__attribute__(a) != r[0].__attribute__(a)) return false;
            }
            return true;
        };

        // Collect all clusters
        let i = 0;
        let partitions = nextProps.partitions;
        let clusters: webdb.RowProxy[][][] = [];
        for (let i = 0; i < partitions.length; ) {
            let cluster: webdb.RowProxy[][] = [partitions[i]];
            for (++i; i < partitions.length && sameCluster(cluster[0], partitions[i]); ++i) {
                cluster.push(partitions[i]);
            }
            clusters.push(cluster);
        }
        return {
            partitions: nextProps.partitions,
            clusterBy: nextProps.clusterBy,
            clusteredPartitions: clusters,
        };
    }

    public render() {
        return (
            <vy.VictoryGroup>{this.state.clusteredPartitions.map((c, i) => this.props.children(c, i))}</vy.VictoryGroup>
        );
    }
}

interface StackedChartsProps {
    /// The key
    clusterId: number;
    /// The partitions
    partitions: webdb.RowProxy[][];
    /// The children
    children: (rows: webdb.RowProxy[], clusterId: number, stackId: number) => React.ReactNode | React.ReactNode[];
}

function StackedCharts(props: StackedChartsProps) {
    console.log("STACKED");
    console.log(props.partitions);
    return (
        <vy.VictoryStack key={props.clusterId}>
            {props.partitions.map((p, i) => props.children(p, props.clusterId, i))}
        </vy.VictoryStack>
    );
}

interface Props {
    appContext: IAppContext;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
    vizInfo: core.model.VizInfo;
}

export class VictoryChartClustered extends React.Component<Props> {
    public renderComponent(
        componentId: number,
        component: core.model.VizComponentSpec,
        partitions: webdb.RowProxy[][],
    ) {
        const targetQualified = this.props.vizInfo.nameQualified;
        const table = this.props.dbObjects.get(targetQualified)!;
        const dataView = component.dataView;
        const dataQuery = this.props.vizInfo.dataQuery;

//        const resolveColumns = (clusterId: number, partitionId: number) => {
//            const xi = (dataQuery.clusterBy.length > 0) ? 0 : clusterId;
//            const yi = (dataQuery.stackBy.length > 0) ? 0 : partitionId;
//            let x = undefined;
//            let y = undefined;
//            if (xi > dataView.x.length) {
//                console.error(`x column out of bounds, clusterId=${clusterId}, partitionId=${partitionId}`);
//            } else {
//                x = table.columnNames[dataQuery.columns[dataView.x[xi]]];
//            }
//            if (yi > dataView.y.length) {
//                console.error(`y column out of bounds, clusterId=${clusterId}, partitionId=${partitionId}`);
//            } else {
//                y = table.columnNames[dataQuery.columns[dataView.y[yi]]];
//            }
//            console.log({x, y});
//            return {x, y};
//        };
//
//        // Renderers
//        const renderComponent = (data: webdb.RowProxy[], clusterId: number, partitionId: number): React.ReactNode => {
//            const dataProps = {
//                data,
//                ...resolveColumns(clusterId, partitionId)
//            };
//            const c = component;
//            const ci = clusterId * partitionId;
//            switch (component.type) {
//                case ComponentType.AREA:
//                    console.log(`AREA ${clusterId} ${partitionId}`);
//                    console.log(data);
//                    return <vy.VictoryArea key={ci} style={c.styles} {...dataProps} />;
//                case ComponentType.BAR:
//                    console.log(`BAR ${clusterId} ${partitionId}`);
//                    console.log(data);
//                    return <vy.VictoryBar key={ci} style={c.styles} {...dataProps} />;
//                case ComponentType.CANDLESTICK:
//                    return <vy.VictoryCandlestick key={ci} style={c.styles} {...dataProps} />;
//                case ComponentType.ERROR_BAR:
//                    return <vy.VictoryErrorBar key={ci} style={c.styles} {...dataProps} />;
//                case ComponentType.HISTOGRAM:
//                    return <vy.VictoryHistogram key={ci} style={c.styles} {...dataProps} />;
//                case ComponentType.LINE:
//                    return <vy.VictoryLine key={ci} style={c.styles} {...dataProps} />;
//                case ComponentType.SCATTER:
//                    return <vy.VictoryScatter key={ci} style={c.styles} {...dataProps} />;
//                default:
//                    return <div />;
//            }
//        };
//        const noClusters = (fn: (partitions: webdb.RowProxy[][], clusterId: number) => React.ReactNode) =>
//            fn(partitions, 0);
//        const clustered = (componentId: number, fn: (partitions: webdb.RowProxy[][], clusterId: number) => React.ReactNode) => (
//            <ClusteredCharts key={componentId} partitions={partitions} clusterBy={dataQuery.clusterBy}>
//                {fn}
//            </ClusteredCharts>
//        );
//        const noStacks = (fn: (rows: webdb.RowProxy[], clusterId: number, partitionId: number) => React.ReactNode) => (
//            partitions: webdb.RowProxy[][],
//            clusterId: number,
//        ) => partitions.map((p, i) => fn(p, clusterId, i));
//        const stacked = (fn: (rows: webdb.RowProxy[], clusterId: number, partitionId: number) => React.ReactNode) => (
//            partitions: webdb.RowProxy[][],
//            clusterId: number,
//        ) => (
//            <StackedCharts key={clusterId} clusterId={clusterId} partitions={partitions}>
//                {fn}
//            </StackedCharts>
//        );
//
//        // Combine cluster & stack renderers
//        if (component.typeModifiers.has(TypeModifier.CLUSTERED)) {
//            if (component.typeModifiers.has(TypeModifier.STACKED)) {
//                return clustered(componentId, stacked(renderComponent));
//            } else {
//                return clustered(componentId, noStacks(renderComponent));
//            }
//        } else {
//            if (component.typeModifiers.has(TypeModifier.STACKED)) {
//                return noClusters(stacked(renderComponent));
//            } else {
//                return noClusters(noStacks(renderComponent));
//            }
//        }
        return <div key={componentId} />
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
