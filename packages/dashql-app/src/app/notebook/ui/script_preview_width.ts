import * as React from 'react';

import type { EditorView } from '@codemirror/view';

const PREVIEW_MIN_WIDTH_CHARS = 24;

export function measureScriptPreviewWidth(view: {
    defaultCharacterWidth: number;
    scrollDOM: { clientWidth: number };
}): number | null {
    const charWidth = view.defaultCharacterWidth;
    const availableWidth = view.scrollDOM.clientWidth;
    if (!(charWidth > 0) || !(availableWidth > 0)) {
        return null;
    }
    return Math.max(PREVIEW_MIN_WIDTH_CHARS, Math.floor(availableWidth / charWidth));
}

export function measureScriptPreviewWidthOr(view: {
    defaultCharacterWidth: number;
    scrollDOM?: { clientWidth: number };
}, fallback: number): number {
    const scrollDOM = view.scrollDOM;
    return scrollDOM == null
        ? fallback
        : measureScriptPreviewWidth({ defaultCharacterWidth: view.defaultCharacterWidth, scrollDOM }) ?? fallback;
}

export function useScriptPreviewWidth(view: EditorView | null): number | null {
    const [maxWidthChars, setMaxWidthChars] = React.useState<number | null>(null);

    React.useLayoutEffect(() => {
        if (view == null) {
            return;
        }
        let hasMeasured = false;
        const measure = () => {
            const nextMaxWidthChars = measureScriptPreviewWidth(view);
            if (nextMaxWidthChars == null) return;
            setMaxWidthChars(prev => prev === nextMaxWidthChars ? prev : nextMaxWidthChars);
            hasMeasured = true;
        };
        // Don't measure immediately - wait for layout to stabilize
        const resizeObserver = new ResizeObserver(measure);
        resizeObserver.observe(view.scrollDOM);
        // Fallback: measure after a frame if ResizeObserver hasn't fired
        const timeout = setTimeout(() => {
            if (!hasMeasured) {
                measure();
            }
        }, 16);
        return () => {
            resizeObserver.disconnect();
            clearTimeout(timeout);
        };
    }, [view]);

    return maxWidthChars;
}
