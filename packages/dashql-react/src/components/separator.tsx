import * as React from 'react';

import * as styles from './separator.module.css';

/// The pixels that the pointer moves before a press becomes a drag
const DRAG_THRESHOLD = 3;

/// The direction in which a separator moves: `x` between a left and a right panel, `y` between a top and a bottom one
export type SeparatorAxis = 'x' | 'y';

/// What a drag or a key does to the panels of a separator
export interface SeparatorDragHandlers {
    /// The pointer moved along the axis while dragging, the client position and the one of the press
    onMove: (position: number, start: number) => void;
    /// The drag was cancelled, restore the sizes of the press
    onCancel: () => void;
    /// A press that didn't become a drag
    onClick?: () => void;
    /// A key: one step towards the start or the end of the axis, or to the minimum or the maximum
    onKey: (key: 'decrease' | 'increase' | 'min' | 'max') => void;
}

/// The classes of a separator: of the separator along an axis, while it drags, and of the grip inside it
export const SEPARATOR_CLASSES = {
    x: styles.separator_x,
    y: styles.separator_y,
    dragging: styles.dragging,
    handle: styles.handle,
};

const KEYS: Record<SeparatorAxis, Record<string, 'decrease' | 'increase'>> = {
    x: { ArrowLeft: 'decrease', ArrowRight: 'increase' },
    y: { ArrowUp: 'decrease', ArrowDown: 'increase' },
};

/// Drag a separator with the pointer or move it with the keys. The handlers of a drag are those of the render of the
/// press, so that they restore the sizes of the press. While it drags, the cursor stays and the page doesn't take the
/// pointer.
export function useSeparatorDrag(axis: SeparatorAxis, handlers: SeparatorDragHandlers): {
    dragging: boolean;
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
    /// End a drag, e.g. when the separator goes
    stop: () => void;
} {
    const [dragging, setDragging] = React.useState(false);
    const stopDraggingRef = React.useRef<(() => void) | null>(null);
    const stop = React.useCallback(() => stopDraggingRef.current?.(), []);
    React.useEffect(() => stop, [stop]);

    const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        stopDraggingRef.current?.();
        setDragging(true);

        const position = (e: { clientX: number; clientY: number }) => axis === 'x' ? e.clientX : e.clientY;
        const pointerId = event.pointerId;
        const start = position(event);
        let pointerMoved = false;
        const handlePointerMove = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            moveEvent.preventDefault();
            pointerMoved ||= Math.abs(position(moveEvent) - start) >= DRAG_THRESHOLD;
            if (pointerMoved) handlers.onMove(position(moveEvent), start);
        };
        const stopDragging = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerEnd);
            window.removeEventListener('pointercancel', handlePointerEnd);
            document.documentElement.classList.remove(styles.resizing_x, styles.resizing_y);
            if (stopDraggingRef.current === stopDragging) stopDraggingRef.current = null;
            setDragging(false);
        };
        const handlePointerEnd = (endEvent: PointerEvent) => {
            if (endEvent.pointerId !== pointerId) return;
            if (endEvent.type === 'pointercancel') handlers.onCancel();
            else if (!pointerMoved) handlers.onClick?.();
            stopDragging();
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerEnd);
        window.addEventListener('pointercancel', handlePointerEnd);
        document.documentElement.classList.add(axis === 'x' ? styles.resizing_x : styles.resizing_y);
        stopDraggingRef.current = stopDragging;
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
        const key = event.key === 'Home' ? 'min' : event.key === 'End' ? 'max' : KEYS[axis][event.key];
        if (key == null) return;
        event.preventDefault();
        handlers.onKey(key);
    };

    return { dragging, onPointerDown, onKeyDown, stop };
}
