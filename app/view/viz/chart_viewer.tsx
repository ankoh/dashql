import * as React from 'react';
import { Vega } from 'react-vega';
import { VisualizationSpec } from 'vega-embed';
import * as proto from '@dashql/proto';
import { ChunkedResult } from '../../proto/engine_access';
import { withAutoSizer } from '../autosizer';

import styles from './chart_viewer.module.scss';

interface IChartViewerProps {
    width: number;
    height: number;
    data: proto.engine.QueryResult;
    type: ValueOf<proto.tql.VizTypeTypeMap>;
}

interface IChartViewerState {
    spec: VisualizationSpec;
}

export class ChartViewer extends React.Component<
    IChartViewerProps,
    IChartViewerState
> {
    constructor(props: IChartViewerProps) {
        super(props);

        this.state = {
            spec: this.generateSpec(),
        };
    }

    private generateBarValues(data: ChunkedResult): any[] {
        const columnCount = data.getColumnCount();

        if (columnCount == 2) {
            const column1 = data.getColumn(0);
            const column2 = data.getColumn(1);

            return new Array(data.getRowCount())
                .fill(undefined)
                .map((_, i) => ({
                    x: column1[i],
                    y: column2[i],
                }));
        } else if (columnCount >= 3) {
            const column1 = data.getColumn(0);
            const column2 = data.getColumn(1);
            const column3 = data.getColumn(2);

            return new Array(data.getRowCount())
                .fill(undefined)
                .map((_, i) => ({
                    x: column1[i],
                    y: column2[i],
                    z: column3[i],
                }));
        }

        return [];
    }

    private generateBarSpec(data: ChunkedResult) {
        const encoding: any = {};

        const columnCount = data.getColumnCount();

        if (columnCount >= 2) {
            encoding.x = {
                field: 'x',
                type: 'ordinal',
                title: data.getColumnName(0),
                sort: false,
            };

            encoding.y = {
                field: 'y',
                type: 'quantitative',
                title: data.getColumnName(1),
            };
        }

        if (columnCount >= 3) {
            encoding.color = {
                type: 'ordinal',
                field: 'z',
                title: data.getColumnName(2),
                sort: false,
                scale: {
                    scheme: 'category20',
                },
            };
        }

        return {
            mark: {
                type: 'bar',
            },
            data: {
                values: this.generateBarValues(data),
            },
            encoding,
        };
    }

    private generateLineValues(data: ChunkedResult): any[] {
        const columnCount = data.getColumnCount();

        if (columnCount == 2) {
            const x = data.getColumn(0);
            const y = data.getColumn(1);

            return new Array(data.getRowCount())
                .fill(undefined)
                .map((_, i) => ({
                    x: x[i],
                    y: y[i],
                }));
        } else if (columnCount >= 3) {
            const x = data.getColumn(0);
            const values: any[] = [];

            for (let column = 1; column < columnCount; column++) {
                const y = data.getColumn(column);
                const name = data.getColumnName(column);

                for (let i = 0; i < x.length; i++) {
                    const value = y[i];

                    if (value != null) {
                        values.push({
                            x: x[i],
                            y: value,
                            z: name,
                        });
                    }
                }
            }

            return values;
        }

        return [];
    }

    private generateLineSpec(data: ChunkedResult) {
        const encoding: any = {};

        const columnCount = data.getColumnCount();

        if (columnCount >= 2) {
            encoding.x = {
                field: 'x',
                type: 'temporal',
                title: data.getColumnName(0),
                sort: false,
            };

            encoding.y = {
                field: 'y',
                type: 'quantitative',
                title: columnCount < 3 && data.getColumnName(1),
            };
        }

        if (columnCount >= 3) {
            encoding.color = {
                type: 'ordinal',
                field: 'z',
                sort: false,
                title: false,
                scale: {
                    scheme: 'category20',
                },
            };
        }

        return {
            mark: {
                type: 'line',
            },
            data: {
                values: this.generateLineValues(data),
            },
            encoding,
        };
    }

    private generateScatterValues(data: ChunkedResult): any[] {
        const columnCount = data.getColumnCount();

        if (columnCount == 2) {
            const x = data.getColumn(0);
            const y = data.getColumn(1);

            return new Array(data.getRowCount())
                .fill(undefined)
                .map((_, i) => ({
                    x: x[i],
                    y: y[i],
                }));
        } else if (columnCount >= 3) {
            const x = data.getColumn(0);
            const values: any[] = [];

            for (let column = 1; column < columnCount; column++) {
                const y = data.getColumn(column);
                const name = data.getColumnName(column);

                for (let i = 0; i < x.length; i++) {
                    const value = y[i];

                    if (value != null) {
                        values.push({
                            x: x[i],
                            y: value,
                            z: name,
                        });
                    }
                }
            }

            return values;
        }

        return [];
    }

    private generateScatterSpec(data: ChunkedResult) {
        const encoding: any = {};

        const columnCount = data.getColumnCount();

        if (columnCount >= 2) {
            encoding.x = {
                field: 'x',
                type: 'quantitative',
                title: data.getColumnName(0),
                sort: false,
            };

            encoding.y = {
                field: 'y',
                type: 'quantitative',
                title: columnCount < 3 && data.getColumnName(1),
            };
        }

        if (columnCount >= 3) {
            encoding.color = {
                type: 'ordinal',
                field: 'z',
                sort: false,
                title: false,
                scale: {
                    scheme: 'category20',
                },
            };
        }

        return {
            mark: {
                type: 'point',
            },
            data: {
                values: this.generateScatterValues(data),
            },
            encoding,
        };
    }

    private generateChartSpec() {
        const data = new ChunkedResult(this.props.data);

        switch (this.props.type) {
            case proto.tql.VizTypeType.VIZ_AREA:
                return {};
            case proto.tql.VizTypeType.VIZ_BAR:
                return this.generateBarSpec(data);
            case proto.tql.VizTypeType.VIZ_BOX:
                return {};
            case proto.tql.VizTypeType.VIZ_BUBBLE:
                return {};
            case proto.tql.VizTypeType.VIZ_GRID:
                return {};
            case proto.tql.VizTypeType.VIZ_HISTOGRAM:
                return {};
            case proto.tql.VizTypeType.VIZ_LINE:
                return this.generateLineSpec(data);
            case proto.tql.VizTypeType.VIZ_NUMBER:
                return {};
            case proto.tql.VizTypeType.VIZ_PIE:
                return {};
            case proto.tql.VizTypeType.VIZ_POINT:
                return {};
            case proto.tql.VizTypeType.VIZ_SCATTER:
                return this.generateScatterSpec(data);
            case proto.tql.VizTypeType.VIZ_TABLE:
                return {};
            case proto.tql.VizTypeType.VIZ_TEXT:
                return {};
        }
    }

    private generateSpec(): VisualizationSpec {
        return {
            autosize: {
                type: 'fit',
                contains: 'padding',
                resize: true,
            },
            padding: {
                left: 16,
                right: 16,
                top: 16,
                bottom: 8,
            },
            ...(this.generateChartSpec() as VisualizationSpec),
        };
    }

    public componentDidUpdate(prevProps: IChartViewerProps) {
        if (this.props.data != prevProps.data) {
            this.setState({
                spec: this.generateSpec(),
            });
        }
    }

    public render() {
        return (
            <div
                className={styles.chart_viewer}
                style={{
                    width: this.props.width,
                    height: this.props.height,
                }}
            >
                <Vega
                    spec={this.state.spec}
                    actions={false}
                    width={this.props.width}
                    height={this.props.height}
                />
            </div>
        );
    }
}

export default withAutoSizer(ChartViewer);
