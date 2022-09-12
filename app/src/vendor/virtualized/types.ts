import * as React from 'react';
import { Grid } from './grid';
import { List } from './list';
import ScalingCellSizeAndPositionManager from './utils/scaling_cellsize_and_position_manager';

export type CellPosition = { columnIndex: number; rowIndex: number };
export type CellRendererParams = {
    columnIndex: number;
    isScrolling: boolean;
    isVisible: boolean;
    key: string;
    parent: object;
    rowIndex: number;
    style: any;
};
export type CellRenderer = (props: CellRendererParams) => React.ReactElement | null;
export type CellCache = { [key: string]: React.ReactElement };
export type StyleCache = { [key: string]: object };

export type VisibileIndices = { start?: number; stop?: number };

export type IndexParam = {
    index: number;
};

export type CellMeasurerCache = {
    has(rowIndex: number, columnIndex: number): boolean;
    getWidth(rowIndex: number, columnIndex: number): number;
    getHeight(rowIndex: number, columnIndex: number): number;
    hasFixedHeight(): boolean;
    hasFixedWidth(): boolean;
    rowHeight(index: IndexParam): boolean;
};

export type CellRangeRendererParams = {
    cellCache: CellCache;
    cellRenderer: CellRenderer;
    columnSizeAndPositionManager: ScalingCellSizeAndPositionManager;
    columnStartIndex: number;
    columnStopIndex: number;
    deferredMeasurementCache?: CellMeasurerCache;
    horizontalOffsetAdjustment: number;
    isScrolling: boolean;
    isScrollingOptOut: boolean;
    parent: Grid | List;
    rowSizeAndPositionManager: ScalingCellSizeAndPositionManager;
    rowStartIndex: number;
    rowStopIndex: number;
    scrollLeft: number;
    scrollTop: number;
    styleCache: StyleCache;
    verticalOffsetAdjustment: number;
    visibleColumnIndices: VisibileIndices;
    visibleRowIndices: VisibileIndices;
};

export type CellRangeRenderer = (params: CellRangeRendererParams) => React.ReactElement[];

export type CellSizeGetter = (params: { index: number }) => number;

export type CellSize = CellSizeGetter | number;

export type NoContentRenderer = () => React.ReactElement | null;

export type GridScroll = {
    clientHeight: number;
    clientWidth: number;
    scrollHeight: number;
    scrollLeft: number;
    scrollTop: number;
    scrollWidth: number;
};

export type ListScroll = {
    clientHeight: number;
    scrollHeight: number;
    scrollTop: number;
};

export type ScrollbarPresenceChange = {
    horizontal: boolean;
    vertical: boolean;
    size: number;
};

export type RenderedSection = {
    columnOverscanStartIndex: number;
    columnOverscanStopIndex: number;
    columnStartIndex: number;
    columnStopIndex: number;
    rowOverscanStartIndex: number;
    rowOverscanStopIndex: number;
    rowStartIndex: number;
    rowStopIndex: number;
};

export type OverscanIndicesGetterParams = {
    // One of SCROLL_DIRECTION_HORIZONTAL or SCROLL_DIRECTION_VERTICAL
    direction: 'horizontal' | 'vertical';

    // One of SCROLL_DIRECTION_BACKWARD or SCROLL_DIRECTION_FORWARD
    scrollDirection: -1 | 1;

    // Number of rows or columns in the current axis
    cellCount: number;

    // Maximum number of cells to over-render in either direction
    overscanCellsCount: number;

    // Begin of range of visible cells
    startIndex: number;

    // End of range of visible cells
    stopIndex: number;
};

export type OverscanIndices = {
    overscanStartIndex: number;
    overscanStopIndex: number;
};

export type OverscanIndicesGetter = (params: OverscanIndicesGetterParams) => OverscanIndices;

export type Alignment = 'auto' | 'end' | 'start' | 'center';

export type VisibleCellRange = {
    start?: number;
    stop?: number;
};

export type RowRendererParams = {
    index: number;
    isScrolling: boolean;
    isVisible: boolean;
    key: string;
    parent: object;
    style: object;
};

export type RowRenderer = (params: RowRendererParams) => React.ReactElement;

export type RenderedRows = {
    overscanStartIndex: number;
    overscanStopIndex: number;
    startIndex: number;
    stopIndex: number;
};
