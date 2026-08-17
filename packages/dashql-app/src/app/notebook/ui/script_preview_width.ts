import * as React from 'react';

import type { EditorView } from '@codemirror/view';

const PREVIEW_MIN_WIDTH_CHARS = 24;

export function useScriptPreviewWidth(view: EditorView | null): number | null {
    const [maxWidthChars, setMaxWidthChars] = React.useState<number | null>(null);

    React.useLayoutEffect(() => {
        if (view == null) {
            return;
        }
        let hasMeasured = false;
        const measure = () => {
            const charWidth = view.defaultCharacterWidth;
            const availableWidth = view.scrollDOM.clientWidth;
            if (!(charWidth > 0) || !(availableWidth > 0)) {
                return;
            }
            const nextMaxWidthChars = Math.max(PREVIEW_MIN_WIDTH_CHARS, Math.floor(availableWidth / charWidth));
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
