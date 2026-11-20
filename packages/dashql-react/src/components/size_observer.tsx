import * as React from 'react';
import useResizeObserverRaw from '@react-hook/resize-observer';
const useResizeObserver = useResizeObserverRaw as unknown as (target: React.RefObject<HTMLElement | null> | null, callback: (entry: ResizeObserverEntry) => void) => void;

export interface ObservedSize {
    width: number;
    height: number;
}

/// Keep the previous size if the dimensions did not change.
/// Resize observers report a new rect object for every observation.
function keepSameSize(prev: ObservedSize | null, next: ObservedSize | null): ObservedSize | null {
    if (prev !== null && next !== null && prev.width === next.width && prev.height === next.height) {
        return prev;
    }
    return next;
}

export const useObservedSize = (target: React.RefObject<HTMLElement | null>, enabled: boolean = true): ObservedSize | null => {
    const [size, setSize] = React.useState<ObservedSize | null>(null);
    // Measure again when the element changes. The effect reads the ref, it holds the element of a first mount already
    const element = target.current;
    React.useLayoutEffect(() => {
        const next = target.current?.getBoundingClientRect() ?? null;
        setSize(prev => keepSameSize(prev, next));
    }, [target, element]);
    useResizeObserver(enabled ? target : null, (entry: ResizeObserverEntry) => {
        setSize(prev => keepSameSize(prev, entry.contentRect));
    });
    return size;
};
