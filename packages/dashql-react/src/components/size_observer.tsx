import * as React from 'react';
import useResizeObserverRaw from '@react-hook/resize-observer';
import { transitionsEnd } from '../dom/calm_frames.js';
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

/// Report the height of the element once it settles, without a render of the component. A transition in the element,
/// e.g. a morph that changes its height in every frame, reports the height at its end once, so whatever follows the
/// height lays out once and not in every frame of the transition. A change without a transition reports right away.
export function useSettledHeight(element: HTMLElement | null, onHeight: ((height: number) => void) | undefined): void {
    React.useEffect(() => {
        if (element == null || onHeight == null) return;
        let reported: number | null = null;
        let waiting = false;
        let stopped = false;
        const report = () => {
            const height = Math.ceil(element.getBoundingClientRect().height);
            if (height === reported) return;
            reported = height;
            onHeight(height);
        };
        report();
        if (typeof ResizeObserver === 'undefined') return;
        // The resizes during a transition wait for its end together
        const observer = new ResizeObserver(() => {
            if (waiting) return;
            waiting = true;
            void transitionsEnd(element).then(() => {
                waiting = false;
                if (!stopped) report();
            });
        });
        observer.observe(element);
        return () => {
            stopped = true;
            observer.disconnect();
        };
    }, [element, onHeight]);
}
