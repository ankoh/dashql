import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as model from '../../model';
import { connect } from 'react-redux';
import { AutoSizer } from '../../util/autosizer';
import { IAppContext, withAppContext } from '../../app_context';
import { VizCard } from './viz_card';
import * as vy from 'victory';

import TypeModifier = core.proto.syntax.VizComponentTypeModifier;
import ComponentType = core.proto.syntax.VizComponentType;

interface Props {
    appContext: IAppContext;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
    vizInfo: core.model.VizInfo;
}

export class VictoryChartSimple extends React.Component<Props> {
    public renderComponent(i: number, c: core.model.VizComponentSpec, rows: webdb.RowProxy[]) {
        const targetQualified = this.props.vizInfo.nameQualified;
        const table = this.props.dbObjects.get(targetQualified)!;
        let axisProps = {
            dependentAxis: false,
            independentAxis: false,
            polar: false,
        };
        let dataProps = {
            data: rows,
            x: c.dataView.x.length > 1 ? table.columnNames[c.dataView.x[0]] : undefined,
            y: c.dataView.y.length > 1 ? table.columnNames[c.dataView.y[0]] : undefined,
        };
        for (const [modifier, _ok] of c.typeModifiers) {
            switch (modifier) {
                case TypeModifier.Y:
                case TypeModifier.DEPENDENT:
                    axisProps.dependentAxis = true;
                    break;
                case TypeModifier.X:
                case TypeModifier.INDEPENDENT:
                    axisProps.independentAxis = true;
                    break;
                case TypeModifier.POLAR:
                    axisProps.polar = true;
                    break;
                case TypeModifier.STACKED:
                case TypeModifier.CLUSTERED:
                    // unreachable
                    console.assert(false, 'unexpected type modifier');
                    break;
            }
        }
        switch (c.type) {
            case ComponentType.AREA:
                return <vy.VictoryArea key={i} style={c.styles} {...dataProps} />;
            case ComponentType.AXIS:
                return <vy.VictoryAxis key={i} style={c.styles} {...axisProps} />;
            case ComponentType.BAR:
                return <vy.VictoryBar key={i} style={c.styles} {...dataProps} />;
            case ComponentType.BOX_PLOT:
                return <vy.VictoryBoxPlot key={i} style={c.styles} {...dataProps} />;
            case ComponentType.CANDLESTICK:
                return <vy.VictoryCandlestick key={i} style={c.styles} {...dataProps} />;
            case ComponentType.ERROR_BAR:
                return <vy.VictoryErrorBar key={i} style={c.styles} {...dataProps} />;
            case ComponentType.HISTOGRAM:
                return <vy.VictoryHistogram key={i} style={c.styles} {...dataProps} />;
            case ComponentType.LINE:
                return <vy.VictoryLine key={i} style={c.styles} {...dataProps} />;
            case ComponentType.PIE:
                return <vy.VictoryPie key={i} style={c.styles} {...dataProps} />;
            case ComponentType.SCATTER:
                return <vy.VictoryScatter key={i} style={c.styles} {...dataProps} />;
            case ComponentType.VORONOI:
                return <vy.VictoryVoronoi key={i} style={c.styles} {...dataProps} />;
            case ComponentType.NUMBER:
            case ComponentType.TABLE:
            case ComponentType.TEXT:
                return <div />;
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
                        <core.access.ProxyProvider result={result}>
                            {(_result, rows) => (
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
                                                this.renderComponent(i, c, rows),
                                            )}
                                        </vy.VictoryChart>
                                    )}
                                </AutoSizer>
                            )}
                        </core.access.ProxyProvider>
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

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(VictoryChartSimple));
