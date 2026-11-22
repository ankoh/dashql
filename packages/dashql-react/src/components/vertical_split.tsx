import * as React from 'react';

import { classNames } from '../dom/classnames.js';
import { SEPARATOR_CLASSES, useSeparatorDrag } from './separator.js';
import * as styles from './vertical_split.module.css';

const DEFAULT_SEPARATOR_SIZE = 12;
const KEYBOARD_STEP = 0.05;

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
    /// The height of the separator row in pixels
    separatorSize?: number;
    separatorClassName?: string;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

export const VerticalSplit: React.FC<VerticalSplitProps> = (props) => {
    const defaultRatio = clamp(props.defaultRatio ?? 0.4, 0, 1);
    const minFirstSize = props.minFirstSize ?? 120;
    const minSecondSize = props.minSecondSize ?? 120;
    const collapsedSecondSize = props.collapsedSecondSize ?? 40;
    const separatorSize = props.separatorSize ?? DEFAULT_SEPARATOR_SIZE;
    const [ratio, setRatio] = React.useState(defaultRatio);
    const [ratioBounds, setRatioBounds] = React.useState<[number, number]>([defaultRatio, defaultRatio]);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const getRatioBounds = React.useCallback((): [number, number] => {
        const height = containerRef.current?.getBoundingClientRect().height ?? 0;
        const availableHeight = Math.max(0, height - separatorSize);
        if (availableHeight === 0 || availableHeight < minFirstSize + minSecondSize) {
            return [defaultRatio, defaultRatio];
        }
        return [minFirstSize / availableHeight, 1 - minSecondSize / availableHeight];
    }, [defaultRatio, minFirstSize, minSecondSize, separatorSize]);

    const resizeToPointer = React.useCallback((clientY: number) => {
        const container = containerRef.current;
        if (container == null) return;
        const rect = container.getBoundingClientRect();
        const availableHeight = rect.height - separatorSize;
        if (availableHeight <= 0) return;
        const [minimum, maximum] = getRatioBounds();
        const nextRatio = (clientY - rect.top - separatorSize / 2) / availableHeight;
        setRatio(clamp(nextRatio, minimum, maximum));
    }, [getRatioBounds, separatorSize]);

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

    const drag = useSeparatorDrag('y', {
        onMove: resizeToPointer,
        onCancel: () => setRatio(ratio),
        // A click swaps the sizes of the panels
        onClick: () => {
            const [minimum, maximum] = getRatioBounds();
            setRatio(clamp(1 - ratio, minimum, maximum));
        },
        onKey: key => {
            const [minimum, maximum] = getRatioBounds();
            const next = key === 'decrease' ? ratio - KEYBOARD_STEP : key === 'increase' ? ratio + KEYBOARD_STEP : key === 'min' ? minimum : maximum;
            setRatio(clamp(next, minimum, maximum));
        },
    });

    const stopDragging = drag.stop;
    React.useEffect(() => {
        if (props.secondCollapsed) stopDragging();
    }, [props.secondCollapsed, stopDragging]);

    const ratioPercent = Math.round(ratio * 100);
    const gridTemplateRows = props.secondCollapsed
        ? `minmax(0, 1fr) ${separatorSize}px ${collapsedSecondSize}px`
        : `minmax(${minFirstSize}px, ${ratio}fr) ${separatorSize}px minmax(${minSecondSize}px, ${1 - ratio}fr)`;
    return (
        <div
            ref={containerRef}
            className={classNames(styles.container, props.className)}
            style={{ gridTemplateRows }}
        >
            <div className={styles.first}>{props.first}</div>
            {props.secondCollapsed ? (
                <div className={styles.collapsed_separator} aria-hidden="true" />
            ) : (
                <div
                    className={classNames(SEPARATOR_CLASSES.y, props.separatorClassName, {
                        [SEPARATOR_CLASSES.dragging]: drag.dragging,
                    })}
                    role="separator"
                    data-electron-drag-region="false"
                    tabIndex={0}
                    aria-label={props.separatorLabel ?? 'Resize panels'}
                    aria-orientation="horizontal"
                    aria-valuemin={Math.round(ratioBounds[0] * 100)}
                    aria-valuemax={Math.round(ratioBounds[1] * 100)}
                    aria-valuenow={ratioPercent}
                    aria-valuetext={`${ratioPercent}% for the top panel`}
                    title="Drag to resize; click to swap panel sizes"
                    onPointerDown={drag.onPointerDown}
                    onKeyDown={drag.onKeyDown}
                >
                    <span className={SEPARATOR_CLASSES.handle} aria-hidden="true" />
                </div>
            )}
            <div className={styles.second}>{props.second}</div>
        </div>
    );
};
