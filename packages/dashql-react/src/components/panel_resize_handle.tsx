import * as React from 'react';

import { classNames } from '../dom/classnames.js';
import * as styles from './panel_resize_handle.module.css';

const KEYBOARD_STEP = 16;
/// The pixels that the pointer moves before a press becomes a drag
const DRAG_THRESHOLD = 3;

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

/// A vertical bar between a panel and the content right of it that resizes the panel, the look of the separator of a
/// VerticalSplit turned by 90 degrees. The parent holds the size and lays out the panel.
export const PanelResizeHandle: React.FC<PanelResizeHandleProps> = (props) => {
    const { size, minSize, maxSize, onResize } = props;
    const [isDragging, setIsDragging] = React.useState(false);
    const stopDraggingRef = React.useRef<(() => void) | null>(null);

    const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        stopDraggingRef.current?.();
        setIsDragging(true);

        const pointerId = event.pointerId;
        const startX = event.clientX;
        const startSize = size;
        let pointerMoved = false;
        const handlePointerMove = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            moveEvent.preventDefault();
            pointerMoved ||= Math.abs(moveEvent.clientX - startX) >= DRAG_THRESHOLD;
            if (!pointerMoved) return;
            onResize(clamp(startSize + moveEvent.clientX - startX, minSize, maxSize));
        };
        const stopDragging = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerEnd);
            window.removeEventListener('pointercancel', handlePointerEnd);
            document.documentElement.classList.remove(styles.resizing);
            if (stopDraggingRef.current === stopDragging) stopDraggingRef.current = null;
            setIsDragging(false);
        };
        const handlePointerEnd = (endEvent: PointerEvent) => {
            if (endEvent.pointerId !== pointerId) return;
            if (endEvent.type === 'pointercancel') onResize(startSize);
            stopDragging();
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerEnd);
        window.addEventListener('pointercancel', handlePointerEnd);
        // The cursor stays and the content doesn't take the pointer while it moves over it
        document.documentElement.classList.add(styles.resizing);
        stopDraggingRef.current = stopDragging;
    }, [size, minSize, maxSize, onResize]);

    const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        let nextSize: number | null = null;
        switch (event.key) {
            case 'ArrowLeft':
                nextSize = size - KEYBOARD_STEP;
                break;
            case 'ArrowRight':
                nextSize = size + KEYBOARD_STEP;
                break;
            case 'Home':
                nextSize = minSize;
                break;
            case 'End':
                nextSize = maxSize;
                break;
        }
        if (nextSize == null) return;
        event.preventDefault();
        onResize(clamp(nextSize, minSize, maxSize));
    }, [size, minSize, maxSize, onResize]);

    React.useEffect(() => () => stopDraggingRef.current?.(), []);

    const roundedSize = Math.round(size);
    return (
        <div
            className={classNames(styles.separator, props.className, {
                [styles.dragging]: isDragging,
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
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
        >
            <span className={styles.handle} aria-hidden="true" />
        </div>
    );
};
