import * as React from 'react';
import { Vega } from 'react-vega';
import { VisualizationSpec } from 'vega-embed';
import { AutoSizer } from 'react-virtualized';
import { withAutoSizer } from '../autosizer';
import './chart_viewer.scss';

const data: any = {
    table: [
        {"category": "A", "amount": 28},
        {"category": "B", "amount": 55},
        {"category": "C", "amount": 43},
        {"category": "D", "amount": 91},
        {"category": "E", "amount": 81},
        {"category": "F", "amount": 53},
        {"category": "G", "amount": 19},
        {"category": "H", "amount": 87}
    ]
};

const spec: VisualizationSpec = {
    autosize: {
        type: "fit",
        contains: "padding"
    },

    padding: { left: 40, right: 20, top: 5, bottom: 24 },

    scales: [
        {
            name: 'xscale',
            type: 'band',
            range: 'width',
            domain: { data: 'table', field: 'category' },
        },
        {
            name: 'yscale',
            nice: true,
            range: 'height',
            domain: { data: 'table', field: 'amount' },
        },
    ],

    data: [ {name: 'table'} ],

    axes: [
        { orient: 'bottom', scale: 'xscale' },
        { orient: 'left', scale: 'yscale' }
    ],

    marks: [
        {
            type: 'rect',
            from: { data: 'table' },
            encode: {
                enter: {
                    x: { scale: 'xscale', field: 'category', offset: 1 },
                    width: { scale: 'xscale', band: 1, offset: -1 },
                    y: { scale: 'yscale', field: 'amount' },
                    y2: { scale: 'yscale', value: 0 },
                },
                update: {
                    fill: { value: 'steelblue' },
                },
                hover: {
                    fill: { value: 'red' },
                },
            },
        },
        {
            type: 'text',
            encode: {
                enter: {
                    align: { value: 'center' },
                    baseline: { value: 'bottom' },
                    fill: { value: '#333' },
                },
            },
        },
    ],
};


interface IChartViewerProps {
    width: number;
    height: number;
}

interface IChartViewerState {
}

export class ChartViewer extends React.Component<IChartViewerProps, IChartViewerState> {
    public render() {
        return (
            <div className="chart_viewer">
                <Vega spec={spec} data={data} actions={false} width={this.props.width} height={this.props.height} />
            </div>
        );
    }
}

export default withAutoSizer(ChartViewer);

