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

export type BaseWidgetModel = {
    id: number;
    position: Position;
}

export type IntegerParameterModel = BaseWidgetModel & {
    type: WidgetType.Parameter | ParameterType.Integer;
    content: void;
};

export type FloatParameterModel = BaseWidgetModel & {
    type: WidgetType.Parameter | ParameterType.Float;
    content: void;
};

export type TextParameterModel = BaseWidgetModel & {
    type: WidgetType.Parameter | ParameterType.Text;
    content: void;
};

export type DateParameterModel = BaseWidgetModel & {
    type: WidgetType.Parameter | ParameterType.Date;
    content: void;
};

export type DatetimeParameterModel = BaseWidgetModel & {
    type: WidgetType.Parameter | ParameterType.Datetime;
    content: void;
};

export type TimeParameterModel = BaseWidgetModel & {
    type: WidgetType.Parameter | ParameterType.Time;
    content: void;
};

export type FileParameterModel = BaseWidgetModel & {
    type: WidgetType.Parameter | ParameterType.File;
    content: void;
};

export type AreaChartModel = BaseWidgetModel & {
    type: WidgetType.Chart | ChartType.Area;
    content: void;
};

export type BarChartModel = BaseWidgetModel & {
    type: WidgetType.Chart | ChartType.Bar;
    content: void;
};

export type BoxChartModel = BaseWidgetModel & {
    type: WidgetType.Chart | ChartType.Box;
    content: void;
};

export type BubbleChartModel = BaseWidgetModel & {
    type: WidgetType.Chart | ChartType.Bubble;
    content: void;
};

export type GridChartModel = BaseWidgetModel & {
    type: WidgetType.Chart | ChartType.Grid;
    content: void;
};

export type HistogramChartModel = BaseWidgetModel & {
    type: WidgetType.Chart | ChartType.Histogram;
    content: void;
};

export type LineChartModel = BaseWidgetModel & {
    type: WidgetType.Chart | ChartType.Line;
    content: void;
};

export type NumberChartModel = BaseWidgetModel & {
    type: WidgetType.Chart | ChartType.Number;
    content: void;
};

export type PieChartModel = BaseWidgetModel & {
    type: WidgetType.Chart | ChartType.Pie;
    content: void;
};

export type PointChartModel = BaseWidgetModel & {
    type: WidgetType.Chart | ChartType.Point;
    content: void;
};

export type ScatterChartModel = BaseWidgetModel & {
    type: WidgetType.Chart | ChartType.Scatter;
    content: void;
};

export type TableChartModel = BaseWidgetModel & {
    type: WidgetType.Chart | ChartType.Table;
    content: void;
};

export type TextChartModel = BaseWidgetModel & {
    type: WidgetType.Chart | ChartType.Text;
    content: void;
};

export type WidgetModel = (
    IntegerParameterModel |
    FloatParameterModel |
    TextParameterModel |
    DateParameterModel |
    DatetimeParameterModel |
    TimeParameterModel |
    FileParameterModel |
    AreaChartModel |
    BarChartModel |
    BoxChartModel |
    BubbleChartModel |
    GridChartModel |
    HistogramChartModel |
    LineChartModel |
    NumberChartModel |
    PieChartModel |
    PointChartModel |
    ScatterChartModel |
    TableChartModel |
    TextChartModel
);

export type DashboardModel = {
    widgets: WidgetModel[];
};
