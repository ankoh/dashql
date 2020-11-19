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

export type AreaContent = {
    id: number;
    type: WidgetType.Chart | ChartType.Area;
    position: Position;
    content: void;
};

export type TableContent = {
    id: number;
    type: WidgetType.Chart | ChartType.Table;
    position: Position;
    content: void;
};

export type Widget = AreaContent | TableContent;

export type Dashboard = {
    widgets: Widget[];
};
