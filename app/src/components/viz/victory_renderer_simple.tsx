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

import VizComponentTypeModifier = core.proto.syntax.VizComponentTypeModifier;
import VizComponentType = core.proto.syntax.VizComponentType;

interface Props {
    appContext: IAppContext;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
    vizInfo: core.model.VizInfo;
}

export class VictoryChartSimple extends React.Component<Props> {
    public renderComponent(i: number, c: core.model.VizComponentSpec, rows: webdb.RowProxy[]) {
        let axisProps = {
            dependentAxis: false,
            independentAxis: false,
            polar: false,
        };
        let dataProps = {
            data: rows,
            x: c.data.x?.[0],
            y: c.data.y?.[0],
        };
        for (const [modifier, _ok] of c.typeModifiers) {
            switch (modifier) {
                case VizComponentTypeModifier.Y:
                case VizComponentTypeModifier.DEPENDENT:
                    axisProps.dependentAxis = true;
                    break;
                case VizComponentTypeModifier.X:
                case VizComponentTypeModifier.INDEPENDENT:
                    axisProps.independentAxis = true;
                    break;
                case VizComponentTypeModifier.POLAR:
                    axisProps.polar = true;
                    break;
                case VizComponentTypeModifier.STACKED:
                case VizComponentTypeModifier.GROUPED:
                    // unreachable
                    console.assert(false, "unexpected type modifier");
                    break;
            }
        }

        switch (c.type) {
            case VizComponentType.AREA:
                return <vy.VictoryArea key={i} style={c.styles} {...dataProps} />;
            case VizComponentType.AXIS:
                return <vy.VictoryAxis key={i} style={c.styles} {...axisProps} />;
            case VizComponentType.BAR:
                return <vy.VictoryBar key={i} style={c.styles} {...dataProps} />;
            case VizComponentType.BOX_PLOT:
                return <vy.VictoryBoxPlot key={i} style={c.styles} {...dataProps} />;
            case VizComponentType.CANDLESTICK:
                return <vy.VictoryCandlestick key={i} style={c.styles} {...dataProps} />;
            case VizComponentType.ERROR_BAR:
                return <vy.VictoryErrorBar key={i} style={c.styles} {...dataProps} />;
            case VizComponentType.HISTOGRAM:
                return <vy.VictoryHistogram key={i} style={c.styles} {...dataProps} />;
            case VizComponentType.LINE:
                return <vy.VictoryLine key={i} style={c.styles} {...dataProps} />;
            case VizComponentType.PIE:
                return <vy.VictoryPie key={i} style={c.styles} {...dataProps} />;
            case VizComponentType.SCATTER:
                return <vy.VictoryScatter key={i} style={c.styles} {...dataProps} />;
            case VizComponentType.VORONOI:
                return <vy.VictoryVoronoi key={i} style={c.styles} {...dataProps} />;
            case VizComponentType.NUMBER:
            case VizComponentType.TABLE:
            case VizComponentType.TEXT:
                return <div />;
        }
    }

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
                        <core.access.ScanProvider
                            logger={this.props.appContext.platform!.logger}
                            database={this.props.appContext.platform!.database}
                            targetName={this.props.vizInfo.nameShort}
                            request={new core.access.ScanRequest().withSample(1024)}
                        >
                            {(scan, _req) => (
                                <core.access.ProxyProvider result={scan.result}>
                                    {(_result, rows) => (
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
                                        >
                                            {this.props.vizInfo.components.map((c, i) => this.renderComponent(i, c, rows))}
                                        </vy.VictoryChart>
                                    )}
                                </core.access.ProxyProvider>
                            )}
                        </core.access.ScanProvider>
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

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(VictoryChartSimple));
