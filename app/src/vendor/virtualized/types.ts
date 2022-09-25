import * as React from 'react';
import { Grid } from './grid';
import { List } from './list';

import ScalingCellSizeAndPositionManager from './utils/scaling_cellsize_and_position_manager';

export type GridCellPosition = { columnIndex: number; rowIndex: number };
export type GridCellProps = {
    columnIndex: number;
    isScrolling: boolean;
    isVisible: boolean;
    key: string;
    parent: any;
    rowIndex: number;
    style: any;
};
export type GridCellRenderer = (props: GridCellProps) => React.ReactElement | null;
export type GridCellCache = { [key: string]: React.ReactElement };
export type StyleCache = { [key: string]: any };

export type VisibileIndices = { start?: number; stop?: number };

export type Index = {
    index: number;
};

export type GridCellMeasurerCache = {
    has(rowIndex: number, columnIndex: number): boolean;
    getWidth(rowIndex: number, columnIndex: number): number;
    getHeight(rowIndex: number, columnIndex: number): number;
    hasFixedHeight(): boolean;
    hasFixedWidth(): boolean;
    rowHeight(index: Index): boolean;
};

export type GridCellRangeProps = {
    cellCache: GridCellCache;
    cellRenderer: GridCellRenderer;
    columnSizeAndPositionManager: ScalingCellSizeAndPositionManager;
    columnStartIndex: number;
    columnStopIndex: number;
    deferredMeasurementCache?: GridCellMeasurerCache;
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

export type GridCellRangeRenderer = (params: GridCellRangeProps) => React.ReactElement[];

export type GridCellSizeGetter = (params: { index: number }) => number;

export type GridCellSize = GridCellSizeGetter | number;

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

export type GridRenderedSection = {
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
    direction: 'horizontal' | 'vertical';
    scrollDirection: -1 | 1;
    cellCount: number;
    overscanCellsCount: number;
    startIndex: number;
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

export type ListRowRendererParams = {
    index: number;
    isScrolling: boolean;
    isVisible: boolean;
    key: string;
    parent: any;
    style: any;
};

export type ListRowRenderer = (params: ListRowRendererParams) => React.ReactElement;

export type ListRenderedRows = {
    overscanStartIndex: number;
    overscanStopIndex: number;
    startIndex: number;
    stopIndex: number;
};
