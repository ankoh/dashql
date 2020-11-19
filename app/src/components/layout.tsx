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
                id: 0,
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
                id: 1,
                type: WidgetType.Chart | ChartType.Table,
                position: {
                    x: 6,
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
                return <IntegerParameter />;
            case WidgetType.Parameter | ParameterType.Float:
                return <FloatParameter />;
            case WidgetType.Parameter | ParameterType.Text:
                return <TextParameter />;
            case WidgetType.Parameter | ParameterType.Date:
                return <DateParameter />;
            case WidgetType.Parameter | ParameterType.Datetime:
                return <DatetimeParameter />;
            case WidgetType.Parameter | ParameterType.Time:
                return <TimeParameter />;
            case WidgetType.Parameter | ParameterType.File:
                return <FileParameter />;
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
