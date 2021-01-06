import * as React from 'react';
import * as ReactGrid from 'react-grid-layout';
import { withAutoSizer } from '../util/autosizer';
import { DashboardModel, WidgetModel, WidgetType, ParameterType, ChartType } from '../model/dashboard';
import {
    IntegerParameter,
    FloatParameter,
    TextParameter,
    DateParameter,
    DatetimeParameter,
    TimeParameter,
    FileParameter,
    AreaChart,
    BarChart,
    BoxChart,
    BubbleChart,
    GridChart,
    HistogramChart,
    LineChart,
    NumberChart,
    PieChart,
    PointChart,
    ScatterChart,
    TableChart,
    TextChart,
} from './widgets';

import styles from './layout.module.css';

type Props = {
    width: number;
    height: number;
};

type State = {
    dashboard: DashboardModel;
};

class Layout extends React.Component<Props, State> {
    state = {
        dashboard: {
            widgets: [
                {
                    id: WidgetType.Parameter | ParameterType.Integer,
                    type: WidgetType.Parameter | ParameterType.Integer,
                    position: {
                        x: ParameterType.Integer,
                        y: ParameterType.Integer,
                        width: 6,
                        height: 1,
                    },
                    content: void 0,
                },
                {
                    id: WidgetType.Parameter | ParameterType.Float,
                    type: WidgetType.Parameter | ParameterType.Float,
                    position: {
                        x: ParameterType.Float,
                        y: ParameterType.Float,
                        width: 6,
                        height: 1,
                    },
                    content: void 0,
                },
                {
                    id: WidgetType.Parameter | ParameterType.Text,
                    type: WidgetType.Parameter | ParameterType.Text,
                    position: {
                        x: ParameterType.Text,
                        y: ParameterType.Text,
                        width: 6,
                        height: 1,
                    },
                    content: void 0,
                },
                {
                    id: WidgetType.Parameter | ParameterType.Date,
                    type: WidgetType.Parameter | ParameterType.Date,
                    position: {
                        x: ParameterType.Date,
                        y: ParameterType.Date,
                        width: 6,
                        height: 1,
                    },
                    content: void 0,
                },
                {
                    id: WidgetType.Parameter | ParameterType.Datetime,
                    type: WidgetType.Parameter | ParameterType.Datetime,
                    position: {
                        x: ParameterType.Datetime,
                        y: ParameterType.Datetime,
                        width: 6,
                        height: 1,
                    },
                    content: void 0,
                },
                {
                    id: WidgetType.Parameter | ParameterType.Time,
                    type: WidgetType.Parameter | ParameterType.Time,
                    position: {
                        x: ParameterType.Time,
                        y: ParameterType.Time,
                        width: 6,
                        height: 1,
                    },
                    content: void 0,
                },
                {
                    id: WidgetType.Parameter | ParameterType.File,
                    type: WidgetType.Parameter | ParameterType.File,
                    position: {
                        x: ParameterType.File,
                        y: ParameterType.File,
                        width: 6,
                        height: 1,
                    },
                    content: void 0,
                },
                {
                    id: WidgetType.Chart | ChartType.Bar,
                    type: WidgetType.Chart | ChartType.Bar,
                    position: {
                        x: ChartType.Bar,
                        y: ChartType.Bar,
                        width: 6,
                        height: 1,
                    },
                    content: void 0,
                },
            ],
        },
    };

    renderContent = (widget: WidgetModel) => {
        switch (widget.type) {
            case WidgetType.Parameter | ParameterType.Integer:
                return <IntegerParameter name="IntegerParameter" value={null} onChange={console.log.bind(console)} />;
            case WidgetType.Parameter | ParameterType.Float:
                return <FloatParameter name="FloatParameter" value={null} onChange={console.log.bind(console)} />;
            case WidgetType.Parameter | ParameterType.Text:
                return <TextParameter name="TextParameter" value={null} onChange={console.log.bind(console)} />;
            case WidgetType.Parameter | ParameterType.Date:
                return <DateParameter name="DateParameter" value={null} onChange={console.log.bind(console)} />;
            case WidgetType.Parameter | ParameterType.Datetime:
                return <DatetimeParameter name="DatetimeParameter" value={null} onChange={console.log.bind(console)} />;
            case WidgetType.Parameter | ParameterType.Time:
                return <TimeParameter name="TimeParameter" value={null} onChange={console.log.bind(console)} />;
            case WidgetType.Parameter | ParameterType.File:
                return <FileParameter name="FileParameter" value={null} onChange={console.log.bind(console)} />;
            case WidgetType.Chart | ChartType.Area:
                return <AreaChart />;
            case WidgetType.Chart | ChartType.Bar:
                return <BarChart />;
            case WidgetType.Chart | ChartType.Box:
                return <BoxChart />;
            case WidgetType.Chart | ChartType.Bubble:
                return <BubbleChart />;
            case WidgetType.Chart | ChartType.Grid:
                return <GridChart />;
            case WidgetType.Chart | ChartType.Histogram:
                return <HistogramChart />;
            case WidgetType.Chart | ChartType.Line:
                return <LineChart />;
            case WidgetType.Chart | ChartType.Number:
                return <NumberChart />;
            case WidgetType.Chart | ChartType.Pie:
                return <PieChart />;
            case WidgetType.Chart | ChartType.Point:
                return <PointChart />;
            case WidgetType.Chart | ChartType.Scatter:
                return <ScatterChart />;
            case WidgetType.Chart | ChartType.Table:
                return <TableChart />;
            case WidgetType.Chart | ChartType.Text:
                return <TextChart />;
        }
    };

    renderWidget = (widget: WidgetModel) => {
        return <div key={String(widget.id)}>{this.renderContent(widget)}</div>;
    };

    getLayout = (widgets: WidgetModel[]): ReactGridLayout.Layout[] => {
        return widgets.map(widget => ({
            i: String(widget.id),
            x: widget.position.x,
            y: widget.position.y,
            w: widget.position.width,
            h: widget.position.height,
        }));
    };

    render() {
        return (
            <ReactGrid
                resizeHandles={['se']}
                cols={12}
                width={this.props.width}
                rowHeight={50}
                compactType={null}
                layout={this.getLayout(this.state.dashboard.widgets)}
                onResize={console.log.bind(console)}
            >
                {this.state.dashboard.widgets.map(this.renderWidget)}
            </ReactGrid>
        );
    }
}

export default withAutoSizer(Layout);
