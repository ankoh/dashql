import * as React from 'react';

import { classNames } from '../dom/classnames.js';
import { SEPARATOR_CLASSES, useSeparatorDrag } from './separator.js';

export const KEYBOARD_STEP = 16;

export interface PanelResizeHandleProps {
    /// The width of the panel left of the handle in pixels
    size: number;
    minSize: number;
    maxSize: number;
    onResize: (size: number) => void;
    label?: string;
    className?: string;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

/// A vertical bar between a panel and the content right of it that resizes the panel, the separator of a
/// VerticalSplit along x. The parent holds the size and lays out the panel.
export const PanelResizeHandle: React.FC<PanelResizeHandleProps> = (props) => {
    const { size, minSize, maxSize, onResize } = props;
    const resize = (next: number) => onResize(clamp(next, minSize, maxSize));
    const drag = useSeparatorDrag('x', {
        onMove: (position, start) => resize(size + position - start),
        onCancel: () => onResize(size),
        onKey: key => resize(key === 'decrease' ? size - KEYBOARD_STEP : key === 'increase' ? size + KEYBOARD_STEP : key === 'min' ? minSize : maxSize),
    });

    const roundedSize = Math.round(size);
    return (
        <div
            className={classNames(SEPARATOR_CLASSES.x, props.className, {
                [SEPARATOR_CLASSES.dragging]: drag.dragging,
            })}
            role="separator"
            data-electron-drag-region="false"
            tabIndex={0}
            aria-label={props.label ?? 'Resize panel'}
            aria-orientation="vertical"
            aria-valuemin={Math.round(minSize)}
            aria-valuemax={Math.round(maxSize)}
            aria-valuenow={roundedSize}
            aria-valuetext={`${roundedSize} pixels`}
            title="Drag to resize"
            onPointerDown={drag.onPointerDown}
            onKeyDown={drag.onKeyDown}
        >
            <span className={SEPARATOR_CLASSES.handle} aria-hidden="true" />
        </div>
    );
};
