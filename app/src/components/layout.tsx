import * as React from 'react';
import { withAutoSizer } from '../util/autosizer';
import * as GridLayout from 'react-grid-layout';
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
import {
    Dashboard,
    Widget,
    WidgetType,
    ParameterType,
    ChartType,
} from '../models/dashboard';

import styles from './layout.module.css';

type Props = {
    width: number;
    height: number;
};

class Layout extends React.Component<Props> {
    dashboard: Dashboard = {
        widgets: [
            {
                id: WidgetType.Parameter | ParameterType.Integer,
                type: WidgetType.Parameter | ParameterType.Integer,
                position: {
                    x: 0,
                    y: 0,
                    width: 6,
                    height: 1,
                },
                content: void 0,
            },
            {
                id: WidgetType.Parameter | ParameterType.Float,
                type: WidgetType.Parameter | ParameterType.Float,
                position: {
                    x: 0,
                    y: 0,
                    width: 6,
                    height: 1,
                },
                content: void 0,
            },
            {
                id: WidgetType.Parameter | ParameterType.Text,
                type: WidgetType.Parameter | ParameterType.Text,
                position: {
                    x: 0,
                    y: 0,
                    width: 6,
                    height: 1,
                },
                content: void 0,
            },
            {
                id: WidgetType.Parameter | ParameterType.Date,
                type: WidgetType.Parameter | ParameterType.Date,
                position: {
                    x: 0,
                    y: 0,
                    width: 6,
                    height: 1,
                },
                content: void 0,
            },
            {
                id: WidgetType.Parameter | ParameterType.Datetime,
                type: WidgetType.Parameter | ParameterType.Datetime,
                position: {
                    x: 0,
                    y: 0,
                    width: 6,
                    height: 1,
                },
                content: void 0,
            },
            {
                id: WidgetType.Parameter | ParameterType.Time,
                type: WidgetType.Parameter | ParameterType.Time,
                position: {
                    x: 0,
                    y: 0,
                    width: 6,
                    height: 1,
                },
                content: void 0,
            },
            {
                id: WidgetType.Parameter | ParameterType.File,
                type: WidgetType.Parameter | ParameterType.File,
                position: {
                    x: 0,
                    y: 0,
                    width: 6,
                    height: 1,
                },
                content: void 0,
            },
        ],
    };

    renderContent = (widget: Widget) => {
        switch (widget.type) {
            case WidgetType.Parameter | ParameterType.Integer:
                return (
                    <IntegerParameter
                        name="IntegerParameter"
                        value={null}
                        onChange={console.log.bind(console)}
                    />
                );
            case WidgetType.Parameter | ParameterType.Float:
                return (
                    <FloatParameter
                        name="FloatParameter"
                        value={null}
                        onChange={console.log.bind(console)}
                    />
                );
            case WidgetType.Parameter | ParameterType.Text:
                return (
                    <TextParameter
                        name="TextParameter"
                        value={null}
                        onChange={console.log.bind(console)}
                    />
                );
            case WidgetType.Parameter | ParameterType.Date:
                return (
                    <DateParameter
                        name="DateParameter"
                        value={null}
                        onChange={console.log.bind(console)}
                    />
                );
            case WidgetType.Parameter | ParameterType.Datetime:
                return (
                    <DatetimeParameter
                        name="DatetimeParameter"
                        value={null}
                        onChange={console.log.bind(console)}
                    />
                );
            case WidgetType.Parameter | ParameterType.Time:
                return (
                    <TimeParameter
                        name="TimeParameter"
                        value={null}
                        onChange={console.log.bind(console)}
                    />
                );
            case WidgetType.Parameter | ParameterType.File:
                return (
                    <FileParameter
                        name="FileParameter"
                        value={null}
                        onChange={console.log.bind(console)}
                    />
                );
            case WidgetType.Chart | ChartType.Area:
                return <AreaChart />;
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

    renderWidget = (widget: Widget) => {
        return (
            <div
                key={widget.id}
                data-grid={{
                    x: widget.position.x,
                    y: widget.position.y,
                    w: widget.position.width,
                    h: widget.position.height,
                }}
            >
                {this.renderContent(widget)}
            </div>
        );
    };

    renderDashboard = (dashboard: Dashboard) => {
        return dashboard.widgets.map(this.renderWidget);
    };

    render() {
        return (
            <GridLayout
                className={styles.grid}
                cols={12}
                rowHeight={30}
                width={this.props.width}
                resizeHandles={['ne', 'se', 'sw', 'nw']}
                verticalCompact={false}
            >
                {this.renderDashboard(this.dashboard)}
            </GridLayout>
        );
    }
}

export default withAutoSizer(Layout);
