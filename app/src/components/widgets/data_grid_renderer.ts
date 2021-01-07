import { GridCellProps, GridCellRangeProps } from 'react-virtualized';

/// Default implementation of cellRangeRenderer used by Grid.
/// This renderer supports cell-caching while the user is scrolling.
export function renderCellRange(props: GridCellRangeProps) {
    const renderedCells = [];

    // Browsers have native size limits for elements (eg Chrome 33M pixels, IE 1.5M pixes).
    // User cannot scroll beyond these size limitations.
    // In order to work around this, ScalingCellSizeAndPositionManager compresses offsets.
    // We should never cache styles for compressed offsets though as this can lead to bugs.
    // See issue #576 for more.
    const areOffsetsAdjusted =
        props.columnSizeAndPositionManager.areOffsetsAdjusted() || props.rowSizeAndPositionManager.areOffsetsAdjusted();

    const canCacheStyle = !props.isScrolling && !areOffsetsAdjusted;

    for (let columnIndex = props.columnStartIndex; columnIndex <= props.columnStopIndex; columnIndex++) {
        let columnDatum = props.columnSizeAndPositionManager.getSizeAndPositionOfCell(columnIndex);

        for (let rowIndex = props.rowStartIndex; rowIndex <= props.rowStopIndex; rowIndex++) {
            let rowDatum = props.rowSizeAndPositionManager.getSizeAndPositionOfCell(rowIndex);

            let isVisible =
                columnIndex >= props.visibleColumnIndices.start &&
                columnIndex <= props.visibleColumnIndices.stop &&
                rowIndex >= props.visibleRowIndices.start &&
                rowIndex <= props.visibleRowIndices.stop;
            let key = `${rowIndex}-${columnIndex}`;

            let style: React.CSSProperties;

            // Cache style objects so shallow-compare doesn't re-render unnecessarily.
            if (canCacheStyle && props.styleCache[key]) {
                style = props.styleCache[key];
            } else {
                // In deferred mode, cells will be initially rendered before we know their size.
                // Don't interfere with CellMeasurer's measurements by setting an invalid size.
                if (props.deferredMeasurementCache && !props.deferredMeasurementCache.has(rowIndex, columnIndex)) {
                    // Position not-yet-measured cells at top/left 0,0,
                    // And give them width/height of 'auto' so they can grow larger than the parent Grid if necessary.
                    // Positioning them further to the right/bottom influences their measured size.
                    style = {
                        height: 'auto',
                        left: 0,
                        position: 'absolute',
                        top: 0,
                        width: 'auto',
                    };
                } else {
                    style = {
                        height: rowDatum.size,
                        left: columnDatum.offset + props.horizontalOffsetAdjustment,
                        position: 'absolute',
                        top: rowDatum.offset + props.verticalOffsetAdjustment,
                        width: columnDatum.size,
                    };

                    props.styleCache[key] = style;
                }
            }

            let cellRendererParams: GridCellProps = {
                columnIndex,
                isScrolling: props.isScrolling,
                isVisible,
                key,
                parent: props.parent,
                rowIndex,
                style,
            };
            let renderedCell;

            // Avoid re-creating cells while scrolling.
            // This can lead to the same cell being created many times and can cause performance issues for "heavy" cells.
            // If a scroll is in progress- cache and reuse cells.
            // This cache will be thrown away once scrolling completes.
            // However if we are scaling scroll positions and sizes, we should also avoid caching.
            // This is because the offset changes slightly as scroll position changes and caching leads to stale values.
            // For more info refer to issue #395
            //
            // If isScrollingOptOut is specified, we always cache cells.
            // For more info refer to issue #1028
            if (
                (props.isScrollingOptOut || props.isScrolling) &&
                !props.horizontalOffsetAdjustment &&
                !props.verticalOffsetAdjustment
            ) {
                if (!props.cellCache[key]) {
                    props.cellCache[key] = props.cellRenderer(cellRendererParams);
                }
                renderedCell = props.cellCache[key];

                // If the user is no longer scrolling, don't cache cells.
                // This makes dynamic cell content difficult for users and would also lead to a heavier memory footprint.
            } else {
                renderedCell = props.cellRenderer(cellRendererParams);
            }

            if (renderedCell == null || renderedCell === false) {
                continue;
            }
            if (process.env.NODE_ENV !== 'production') {
                warnAboutMissingStyle(parent, renderedCell);
            }

            renderedCells.push(renderedCell);
        }
    }
    return renderedCells;
}

function warnAboutMissingStyle(parent: any, renderedCell: any) {
    if (process.env.NODE_ENV !== 'production') {
        if (renderedCell) {
            // If the direct child is a CellMeasurer, then we should check its child
            // See issue #611
            if (renderedCell.type && renderedCell.type.__internalCellMeasurerFlag) {
                renderedCell = renderedCell.props.children;
            }

            if (
                renderedCell &&
                renderedCell.props &&
                renderedCell.props.style === undefined &&
                parent.__warnedAboutMissingStyle !== true
            ) {
                parent.__warnedAboutMissingStyle = true;

                console.warn('Rendered cell should include style property for positioning.');
            }
        }
    }
}
