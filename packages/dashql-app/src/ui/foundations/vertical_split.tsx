import * as React from 'react';

import { classNames } from '../../utils/classnames.js';
import * as styles from './vertical_split.module.css';

const SPLIT_GAP_SIZE = 12;
const KEYBOARD_STEP = 0.05;
const MIN_RATIO = 0;
const MAX_RATIO = 1;

export interface VerticalSplitProps {
    first: React.ReactNode;
    second: React.ReactNode;
    className?: string;
    defaultRatio?: number;
    minFirstSize?: number;
    minSecondSize?: number;
    separatorLabel?: string;
    secondCollapsed?: boolean;
    collapsedSecondSize?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

export const VerticalSplit: React.FC<VerticalSplitProps> = (props) => {
    const defaultRatio = clamp(props.defaultRatio ?? 0.4, 0, 1);
    const minFirstSize = props.minFirstSize ?? 120;
    const minSecondSize = props.minSecondSize ?? 120;
    const collapsedSecondSize = props.collapsedSecondSize ?? 40;
    const [ratio, setRatio] = React.useState(defaultRatio);
    const [ratioBounds, setRatioBounds] = React.useState<[number, number]>([defaultRatio, defaultRatio]);
    const [isDragging, setIsDragging] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const stopDraggingRef = React.useRef<(() => void) | null>(null);
    const ratioWhenDraggingStartedRef = React.useRef(defaultRatio);

    const getRatioBounds = React.useCallback((): [number, number] => {
        const height = containerRef.current?.getBoundingClientRect().height ?? 0;
        const availableHeight = Math.max(0, height - SPLIT_GAP_SIZE);
        if (availableHeight === 0 || availableHeight < minFirstSize + minSecondSize) {
            return [defaultRatio, defaultRatio];
        }
        return [minFirstSize / availableHeight, 1 - minSecondSize / availableHeight];
    }, [defaultRatio, minFirstSize, minSecondSize]);

    const resizeToPointer = React.useCallback((clientY: number) => {
        const container = containerRef.current;
        if (container == null) return;
        const rect = container.getBoundingClientRect();
        const availableHeight = rect.height - SPLIT_GAP_SIZE;
        if (availableHeight <= 0) return;
        const [minimum, maximum] = getRatioBounds();
        const nextRatio = (clientY - rect.top - SPLIT_GAP_SIZE / 2) / availableHeight;
        setRatio(clamp(nextRatio, minimum, maximum));
    }, [getRatioBounds]);

    React.useLayoutEffect(() => {
        const container = containerRef.current;
        if (container == null) return;
        const updateBounds = () => {
            const bounds = getRatioBounds();
            setRatioBounds(current => current[0] === bounds[0] && current[1] === bounds[1] ? current : bounds);
            setRatio(current => clamp(current, bounds[0], bounds[1]));
        };
        updateBounds();
        const observer = new ResizeObserver(updateBounds);
        observer.observe(container);
        return () => observer.disconnect();
    }, [getRatioBounds]);

    const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        stopDraggingRef.current?.();
        setIsDragging(true);
        ratioWhenDraggingStartedRef.current = ratio;

        const pointerId = event.pointerId;
        const startY = event.clientY;
        let pointerMoved = false;
        const handlePointerMove = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            moveEvent.preventDefault();
            pointerMoved ||= Math.abs(moveEvent.clientY - startY) >= 3;
            if (!pointerMoved) return;
            resizeToPointer(moveEvent.clientY);
        };
        const stopDragging = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerEnd);
            window.removeEventListener('pointercancel', handlePointerEnd);
            if (stopDraggingRef.current === stopDragging) stopDraggingRef.current = null;
            setIsDragging(false);
        };
        const handlePointerEnd = (endEvent: PointerEvent) => {
            if (endEvent.pointerId !== pointerId) return;
            if (endEvent.type === 'pointercancel') {
                setRatio(ratioWhenDraggingStartedRef.current);
            } else if (!pointerMoved) {
                const [minimum, maximum] = getRatioBounds();
                setRatio(clamp(1 - ratio, minimum, maximum));
            }
            stopDragging();
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerEnd);
        window.addEventListener('pointercancel', handlePointerEnd);
        stopDraggingRef.current = stopDragging;
    }, [getRatioBounds, ratio, resizeToPointer]);

    const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        const [minimum, maximum] = getRatioBounds();
        let nextRatio: number | null = null;
        switch (event.key) {
            case 'ArrowUp':
                nextRatio = ratio - KEYBOARD_STEP;
                break;
            case 'ArrowDown':
                nextRatio = ratio + KEYBOARD_STEP;
                break;
            case 'Home':
                nextRatio = minimum;
                break;
            case 'End':
                nextRatio = maximum;
                break;
        }
        if (nextRatio == null) return;
        event.preventDefault();
        setRatio(clamp(nextRatio, minimum, maximum));
    }, [getRatioBounds, ratio]);

    React.useEffect(() => () => stopDraggingRef.current?.(), []);

    React.useEffect(() => {
        if (props.secondCollapsed) stopDraggingRef.current?.();
    }, [props.secondCollapsed]);

    const ratioPercent = Math.round(ratio * 100);
    const gridTemplateRows = props.secondCollapsed
        ? `minmax(0, 1fr) ${SPLIT_GAP_SIZE}px ${collapsedSecondSize}px`
        : `minmax(${minFirstSize}px, ${ratio}fr) ${SPLIT_GAP_SIZE}px minmax(${minSecondSize}px, ${1 - ratio}fr)`;
    return (
        <div
            ref={containerRef}
            className={classNames(styles.container, props.className, {
                [styles.dragging]: isDragging,
            })}
            style={{ gridTemplateRows }}
        >
            <div className={styles.first}>{props.first}</div>
            {props.secondCollapsed ? (
                <div className={styles.collapsed_separator} aria-hidden="true" />
            ) : (
                <div
                    className={styles.separator}
                    role="separator"
                    tabIndex={0}
                    aria-label={props.separatorLabel ?? 'Resize panels'}
                    aria-orientation="horizontal"
                    aria-valuemin={Math.round(ratioBounds[0] * 100)}
                    aria-valuemax={Math.round(ratioBounds[1] * 100)}
                    aria-valuenow={ratioPercent}
                    aria-valuetext={`${ratioPercent}% for the top panel`}
                    title="Drag to resize; click to swap panel sizes"
                    onPointerDown={handlePointerDown}
                    onKeyDown={handleKeyDown}
                >
                    <span className={styles.handle} aria-hidden="true" />
                </div>
            )}
            <div className={styles.second}>{props.second}</div>
        </div>
    );
};
