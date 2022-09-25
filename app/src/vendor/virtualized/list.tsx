import {
    NoContentRenderer,
    Alignment,
    GridCellSize,
    GridCellPosition,
    OverscanIndicesGetter,
    GridRenderedSection,
    GridCellProps,
    GridScroll,
} from './types';
import { ListRowRenderer, ListRenderedRows, ListScroll } from './types';

import accessibilityOverscanIndicesGetter from './utils/accessibility_overscan_indices_getter';
import Grid from './grid';
import * as React from 'react';
import classNames from 'classnames';

/**
 * It is inefficient to create and manage a large list of DOM elements within a scrolling container
 * if only a few of those elements are visible. The primary purpose of this component is to improve
 * performance by only rendering the DOM nodes that a user is able to see based on their current
 * scroll position.
 *
 * This component renders a virtualized list of elements with either fixed or dynamic heights.
 */

type Props = {
    'aria-label'?: string;
    /**
     * Removes fixed height from the scrollingContainer so that the total height
     * of rows can stretch the window. Intended for use with WindowScroller
     */
    autoHeight?: boolean;
    /** Optional CSS class name */
    className?: string;
    /**
     * Used to estimate the total height of a List before all of its rows have actually been measured.
     * The estimated total height is adjusted as rows are rendered.
     */
    estimatedRowSize?: number;
    /** Height constraint for list (determines how many actual rows are rendered) */
    height: number;
    /** Optional renderer to be used in place of rows when rowCount is 0 */
    noRowsRenderer?: NoContentRenderer;
    /** Callback invoked with information about the slice of rows that were just rendered.  */
    onRowsRendered?: (params: ListRenderedRows) => void;
    /**
     * Callback invoked whenever the scroll offset changes within the inner scrollable region.
     * This callback can be used to sync scrolling between lists, tables, or grids.
     */
    onScroll?: (params: ListScroll) => void;
    /** See Grid#overscanIndicesGetter */
    overscanIndicesGetter?: OverscanIndicesGetter;
    /**
     * Number of rows to render above/below the visible bounds of the list.
     * These rows can help for smoother scrolling on touch devices.
     */
    overscanRowCount?: number;
    /** Either a fixed row height (number) or a function that returns the height of a row given its index.  */
    rowHeight: GridCellSize;
    /** Responsible for rendering a row given an index; ({ index: number }): node */
    rowRenderer: ListRowRenderer;
    /** Number of rows in list. */
    rowCount: number;
    /** See Grid#scrollToAlignment */
    scrollToAlignment?: Alignment;
    /** Row index to ensure visible (by forcefully scrolling if necessary) */
    scrollToIndex?: number;
    /** Vertical offset. */
    scrollTop?: number;
    /** Optional inline style */
    style?: object;
    /** Tab index for focus */
    tabIndex?: number;
    /** Width of list */
    width: number;

    /**
     * PLEASE NOTE
     * The [key: string]: any; line is here on purpose
     * This is due to the need of force re-render of PureComponent
     * Check the following link if you want to know more
     * https://github.com/bvaughn/react-virtualized#pass-thru-props
     */
    [key: string]: any;
};

export class List extends React.PureComponent<Props> {
    static defaultProps: Partial<Props> = {
        autoHeight: false,
        estimatedRowSize: 30,
        onScroll: () => {},
        noRowsRenderer: () => null,
        onRowsRendered: () => {},
        overscanIndicesGetter: accessibilityOverscanIndicesGetter,
        overscanRowCount: 10,
        scrollToAlignment: 'auto',
        scrollToIndex: -1,
        style: {},
    };

    Grid?: React.ElementRef<typeof Grid>;

    forceUpdateGrid() {
        if (this.Grid) {
            this.Grid.forceUpdate();
        }
    }

    /** See Grid#getOffsetForCell */
    getOffsetForRow({ alignment, index }: { alignment: Alignment; index: number }) {
        if (this.Grid) {
            const { scrollTop } = this.Grid.getOffsetForCell({
                alignment,
                rowIndex: index,
                columnIndex: 0,
            });

            return scrollTop;
        }
        return 0;
    }

    /** CellMeasurer compatibility */
    invalidateCellSizeAfterRender({ columnIndex, rowIndex }: GridCellPosition) {
        if (this.Grid) {
            this.Grid.invalidateCellSizeAfterRender({
                rowIndex,
                columnIndex,
            });
        }
    }

    /** See Grid#measureAllCells */
    measureAllRows() {
        if (this.Grid) {
            this.Grid.measureAllCells();
        }
    }

    /** CellMeasurer compatibility */
    recomputeGridSize(pos: GridCellPosition = { columnIndex: 0, rowIndex: 0 }) {
        if (this.Grid) {
            this.Grid.recomputeGridSize({
                rowIndex: pos.rowIndex,
                columnIndex: pos.columnIndex,
            });
        }
    }

    /** See Grid#recomputeGridSize */
    recomputeRowHeights(index: number = 0) {
        if (this.Grid) {
            this.Grid.recomputeGridSize({
                rowIndex: index,
                columnIndex: 0,
            });
        }
    }

    /** See Grid#scrollToPosition */
    scrollToPosition(scrollTop: number = 0) {
        if (this.Grid) {
            this.Grid.scrollToPosition({ scrollTop });
        }
    }

    /** See Grid#scrollToCell */
    scrollToRow(index: number = 0) {
        if (this.Grid) {
            this.Grid.scrollToCell({
                columnIndex: 0,
                rowIndex: index,
            });
        }
    }

    render() {
        const { className, noRowsRenderer, scrollToIndex, width } = this.props;

        const cN = classNames('ReactVirtualized__List', className);

        return (
            <Grid
                {...this.props}
                autoContainerWidth
                cellRenderer={this._cellRenderer}
                className={cN}
                columnWidth={width}
                columnCount={1}
                noContentRenderer={noRowsRenderer}
                onScroll={this._onScroll}
                onSectionRendered={this._onSectionRendered}
                ref={this._setRef}
                scrollToRow={scrollToIndex}
            />
        );
    }

    _cellRenderer = ({ parent, rowIndex, style, isScrolling, isVisible, key }: GridCellProps) => {
        const { rowRenderer } = this.props;

        // TRICKY The style object is sometimes cached by Grid.
        // This prevents new style objects from bypassing shallowCompare().
        // However as of React 16, style props are auto-frozen (at least in dev mode)
        // Check to make sure we can still modify the style before proceeding.
        // https://github.com/facebook/react/commit/977357765b44af8ff0cfea327866861073095c12#commitcomment-20648713
        const widthDescriptor = Object.getOwnPropertyDescriptor(style, 'width');
        if (widthDescriptor && widthDescriptor.writable) {
            // By default, List cells should be 100% width.
            // This prevents them from flowing under a scrollbar (if present).
            style.width = '100%';
        }

        return rowRenderer({
            index: rowIndex,
            style,
            isScrolling,
            isVisible,
            key,
            parent,
        });
    };

    _setRef = (ref?: React.ElementRef<typeof Grid>) => {
        this.Grid = ref;
    };

    _onScroll = ({ clientHeight, scrollHeight, scrollTop }: GridScroll) => {
        const { onScroll } = this.props;

        onScroll({ clientHeight, scrollHeight, scrollTop });
    };

    _onSectionRendered = ({
        rowOverscanStartIndex,
        rowOverscanStopIndex,
        rowStartIndex,
        rowStopIndex,
    }: GridRenderedSection) => {
        const { onRowsRendered } = this.props;

        onRowsRendered({
            overscanStartIndex: rowOverscanStartIndex,
            overscanStopIndex: rowOverscanStopIndex,
            startIndex: rowStartIndex,
            stopIndex: rowStopIndex,
        });
    };
}

export default List;
