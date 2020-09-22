import * as React from 'react';
import { Vega } from 'react-vega';
import { VisualizationSpec } from 'vega-embed';
import * as proto from '@tigon/proto';
import { ChunkedResult } from '../../proto/engine_access';

import styles from './chart_viewer.module.scss';

interface IChartViewerProps {
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
            const column1 = data.formatColumn(0);
            const column2 = data.formatColumn(1);

            return new Array(data.getRowCount())
                .fill(undefined)
                .map((_, i) => ({
                    x: column1[i],
                    y: column2[i],
                }));
        } else if (columnCount >= 3) {
            const column1 = data.formatColumn(0);
            const column2 = data.formatColumn(1);
            const column3 = data.formatColumn(2);

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

    private generateChartSpec() {
        const data = new ChunkedResult(this.props.data);

        switch (this.props.type) {
            case proto.tql.VizTypeType.VIZ_BAR:
                return this.generateBarSpec(data);
        }

        return {};
    }

    private generateSpec(): VisualizationSpec {
        return {
            autosize: {
                type: 'fit',
                contains: 'padding',
            },
            ...(this.generateChartSpec() as any),
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
            <div className={styles.chart_viewer}>
                <Vega spec={this.state.spec} actions={false} />
            </div>
        );
    }
}

export default ChartViewer;
