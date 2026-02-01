import * as React from 'react';
import * as styles from './data_table.module.css';

/// ---------------------------------------------------------------------------
/// Skeleton Overlay (single element overlay for brushing state)
/// Uses CSS gradients + masks to render grid pattern - O(1) DOM cost
/// ---------------------------------------------------------------------------

const SKELETON_BORDER_COLOR = 'rgb(210, 210, 210)';
const SKELETON_PLACEHOLDER_COLOR = 'hsl(210deg 10% 88%)';
const SKELETON_SHIMMER_HIGHLIGHT = 'hsl(210deg 10% 94%)';

// Build a linear-gradient string for vertical column borders from column offsets
function buildColumnBordersGradient(columnXOffsets: Float64Array, firstColumnWidth: number): string {
    const stops: string[] = [];
    stops.push('transparent 0px');

    for (let i = 1; i < columnXOffsets.length; i++) {
        const x = columnXOffsets[i] - firstColumnWidth;
        stops.push(`transparent ${x - 1}px`);
        stops.push(`${SKELETON_BORDER_COLOR} ${x - 1}px`);
        stops.push(`${SKELETON_BORDER_COLOR} ${x}px`);
        stops.push(`transparent ${x}px`);
    }

    return `linear-gradient(90deg, ${stops.join(', ')})`;
}

// Build mask for placeholder rectangles + borders
// Uses one layer per column for placeholders, plus layers for row and column borders
function buildPlaceholderMask(
    columnXOffsets: Float64Array,
    firstColumnWidth: number,
    rowHeight: number
): { mask: string; maskSize: string; maskPosition: string } {
    const paddingY = 6;
    const paddingX = 8;
    const placeholderWidthRatio = 0.6;
    const placeholderHeight = rowHeight - paddingY * 2;

    const masks: string[] = [];
    const sizes: string[] = [];
    const positions: string[] = [];

    // Row borders: 1px horizontal lines at each row boundary (full width, repeating)
    const rowBorderMask = `repeating-linear-gradient(180deg, transparent 0px, transparent ${rowHeight - 1}px, black ${rowHeight - 1}px, black ${rowHeight}px)`;
    masks.push(rowBorderMask);
    sizes.push('100% 100%');
    positions.push('0 0');

    // Column borders: 1px vertical line at each column boundary
    const colBorderStops: string[] = [];
    colBorderStops.push('transparent 0px');
    for (let i = 1; i < columnXOffsets.length; i++) {
        const x = columnXOffsets[i] - firstColumnWidth;
        colBorderStops.push(`transparent ${x - 1}px`);
        colBorderStops.push(`black ${x - 1}px`);
        colBorderStops.push(`black ${x}px`);
        colBorderStops.push(`transparent ${x}px`);
    }
    const colBorderMask = `linear-gradient(90deg, ${colBorderStops.join(', ')})`;
    masks.push(colBorderMask);
    sizes.push('100% 100%');
    positions.push('0 0');

    // Placeholder rectangles: one layer per column with repeating vertical pattern
    for (let i = 1; i < columnXOffsets.length; i++) {
        const x1 = columnXOffsets[i - 1] - firstColumnWidth;
        const x2 = columnXOffsets[i] - firstColumnWidth;
        const cellWidth = x2 - x1;
        const placeholderWidth = Math.max(20, Math.min(cellWidth * placeholderWidthRatio, cellWidth - paddingX * 2));

        // Gradient that shows one rectangle and repeats vertically
        const gradient = `repeating-linear-gradient(180deg, transparent 0px, transparent ${paddingY}px, black ${paddingY}px, black ${paddingY + placeholderHeight}px, transparent ${paddingY + placeholderHeight}px, transparent ${rowHeight}px)`;

        masks.push(gradient);
        sizes.push(`${placeholderWidth}px 100%`);
        positions.push(`${x1 + paddingX}px 0`);
    }

    return {
        mask: masks.join(', '),
        maskSize: sizes.join(', '),
        maskPosition: positions.join(', '),
    };
}

export interface SkeletonStyle {
    background: string;
    backgroundSize: string;
    mask: string;
    maskSize: string;
    maskPosition: string;
    maskRepeat: string;
    WebkitMask: string;
    WebkitMaskSize: string;
    WebkitMaskPosition: string;
    WebkitMaskRepeat: string;
}

// Build the skeleton grid style - compute once per layout change
export function buildSkeletonStyle(
    columnXOffsets: Float64Array,
    firstColumnWidth: number,
    rowHeight: number
): SkeletonStyle {
    // Row borders: horizontal lines at rowHeight intervals
    const rowBorders = `repeating-linear-gradient(180deg, transparent 0px, transparent ${rowHeight - 1}px, ${SKELETON_BORDER_COLOR} ${rowHeight - 1}px, ${SKELETON_BORDER_COLOR} ${rowHeight}px)`;
    // Column borders: vertical lines at column offsets
    const columnBorders = buildColumnBordersGradient(columnXOffsets, firstColumnWidth);
    // Shimmer: animated gradient overlay
    const shimmer = `linear-gradient(90deg, transparent 0%, transparent 40%, ${SKELETON_SHIMMER_HIGHLIGHT} 50%, transparent 60%, transparent 100%)`;
    // Mask for individual placeholder rectangles (one layer per column)
    const placeholderMask = buildPlaceholderMask(columnXOffsets, firstColumnWidth, rowHeight);

    return {
        // Layers: shimmer on top, then borders, then placeholder color at bottom
        background: `${shimmer}, ${rowBorders}, ${columnBorders}, ${SKELETON_PLACEHOLDER_COLOR}`,
        backgroundSize: '200% 100%, 100% 100%, 100% 100%, 100% 100%',
        // Per-column masks, each showing rectangles at row intervals
        mask: placeholderMask.mask,
        maskSize: placeholderMask.maskSize,
        maskPosition: placeholderMask.maskPosition,
        maskRepeat: 'no-repeat',
        WebkitMask: placeholderMask.mask,
        WebkitMaskSize: placeholderMask.maskSize,
        WebkitMaskPosition: placeholderMask.maskPosition,
        WebkitMaskRepeat: 'no-repeat',
    };
}

export interface SkeletonOverlayProps {
    headerHeight: number;
    firstColumnWidth: number;
    totalColumnsWidth: number;
    totalDataHeight: number;
    skeletonStyle: SkeletonStyle;
}

// Simple single-element overlay - O(1) render cost regardless of grid size
export function SkeletonOverlay(props: SkeletonOverlayProps) {
    return (
        <div
            className={styles.skeleton_overlay}
            style={{
                position: 'absolute',
                top: props.headerHeight,
                left: props.firstColumnWidth,
                width: props.totalColumnsWidth - props.firstColumnWidth,
                height: props.totalDataHeight,
                zIndex: 4,
                pointerEvents: 'none',
                backgroundColor: 'var(--data_table_bg_data)',
                ...props.skeletonStyle,
            }}
        />
    );
}
