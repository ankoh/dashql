export type Position = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export enum ParameterType {
    Integer,
    Float,
    Text,
    Date,
    Datetime,
    Time,
    File,
}

export enum ChartType {
    Area,
    Bar,
    Box,
    Bubble,
    Grid,
    Histogram,
    Line,
    Number,
    Pie,
    Point,
    Scatter,
    Table,
    Text,
}

export enum WidgetType {
    Parameter = 0x100,
    Chart = 0x200,
}

export interface BaseWidgetModel {
    id: number;
    position: Position;
}

export interface IntegerParameterModel extends BaseWidgetModel {
    type: WidgetType.Parameter | ParameterType.Integer;
    content: void;
}

export interface FloatParameterModel extends BaseWidgetModel {
    type: WidgetType.Parameter | ParameterType.Float;
    content: void;
}

export interface TextParameterModel extends BaseWidgetModel {
    type: WidgetType.Parameter | ParameterType.Text;
    content: void;
}

export interface DateParameterModel extends BaseWidgetModel {
    type: WidgetType.Parameter | ParameterType.Date;
    content: void;
}

export interface DatetimeParameterModel extends BaseWidgetModel {
    type: WidgetType.Parameter | ParameterType.Datetime;
    content: void;
}

export interface TimeParameterModel extends BaseWidgetModel {
    type: WidgetType.Parameter | ParameterType.Time;
    content: void;
}

export interface FileParameterModel extends BaseWidgetModel {
    type: WidgetType.Parameter | ParameterType.File;
    content: void;
}

export interface AreaChartModel extends BaseWidgetModel {
    type: WidgetType.Chart | ChartType.Area;
    content: void;
}

export interface BarChartModel extends BaseWidgetModel {
    type: WidgetType.Chart | ChartType.Bar;
    content: void;
}

export interface BoxChartModel extends BaseWidgetModel {
    type: WidgetType.Chart | ChartType.Box;
    content: void;
}

export interface BubbleChartModel extends BaseWidgetModel {
    type: WidgetType.Chart | ChartType.Bubble;
    content: void;
}

export interface GridChartModel extends BaseWidgetModel {
    type: WidgetType.Chart | ChartType.Grid;
    content: void;
}

export interface HistogramChartModel extends BaseWidgetModel {
    type: WidgetType.Chart | ChartType.Histogram;
    content: void;
}

export interface LineChartModel extends BaseWidgetModel {
    type: WidgetType.Chart | ChartType.Line;
    content: void;
}

export interface NumberChartModel extends BaseWidgetModel {
    type: WidgetType.Chart | ChartType.Number;
    content: void;
}

export interface PieChartModel extends BaseWidgetModel {
    type: WidgetType.Chart | ChartType.Pie;
    content: void;
}

export interface PointChartModel extends BaseWidgetModel {
    type: WidgetType.Chart | ChartType.Point;
    content: void;
}

export interface ScatterChartModel extends BaseWidgetModel {
    type: WidgetType.Chart | ChartType.Scatter;
    content: void;
}

export interface TableChartModel extends BaseWidgetModel {
    type: WidgetType.Chart | ChartType.Table;
    content: void;
}

export interface TextChartModel extends BaseWidgetModel {
    type: WidgetType.Chart | ChartType.Text;
    content: void;
}

export type WidgetModel =
    | IntegerParameterModel
    | FloatParameterModel
    | TextParameterModel
    | DateParameterModel
    | DatetimeParameterModel
    | TimeParameterModel
    | FileParameterModel
    | AreaChartModel
    | BarChartModel
    | BoxChartModel
    | BubbleChartModel
    | GridChartModel
    | HistogramChartModel
    | LineChartModel
    | NumberChartModel
    | PieChartModel
    | PointChartModel
    | ScatterChartModel
    | TableChartModel
    | TextChartModel;

export type DashboardModel = {
    widgets: WidgetModel[];
};
