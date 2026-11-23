import * as React from 'react';
import { transitionsEnd } from '../dom/calm_frames.js';

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

/// The size of the element of a ref. The size follows the element: one that mounts after the component, e.g. a view
/// that renders it only for a result, and one that replaces it, the observer moves to the new element.
export const useObservedSize = (target: React.RefObject<HTMLElement | null>, enabled: boolean = true): ObservedSize | null => {
    const [size, setSize] = React.useState<ObservedSize | null>(null);
    const [element, setElement] = React.useState<HTMLElement | null>(null);
    // A ref changes without a render, the effect looks at it after every commit of the component. A new element is
    // measured right away and observed from then on, no element has no size.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ref changes in a commit, the state changes only with the element and settles after one render
    React.useLayoutEffect(() => {
        const current = target.current;
        if (current === element) return;
        setElement(current);
        const next = current?.getBoundingClientRect() ?? null;
        setSize(prev => keepSameSize(prev, next));
    });
    // An observer of its own: a shared one would keep the ResizeObserver that was global when it was created, e.g. the
    // stub of a test that ran before
    React.useLayoutEffect(() => {
        if (!enabled || element === null || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(entries => {
            const entry = entries[entries.length - 1];
            if (entry !== undefined) setSize(prev => keepSameSize(prev, entry.contentRect));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [element, enabled]);
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
