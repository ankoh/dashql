interface ScrollbarLayout {
    /// The width of a vertical scrollbar in the layout, 0 for overlay scrollbars
    width: number;
    /// The height of a horizontal scrollbar in the layout, 0 for overlay scrollbars
    height: number;
}

let SCROLLBAR_LAYOUT: ScrollbarLayout | null = null;

// Overlay scrollbars report no layout size but still paint over content.
const OVERLAY_SCROLLBAR_WIDTH = 12;
const OVERLAY_SCROLLBAR_HEIGHT = 12;

// Kudos to: https://www.robinwieruch.de/react-hook-scrollbar-width/

/// The scrollbar style of old Edge, missing in the DOM types
type MsOverflowStyle = CSSStyleDeclaration & { msOverflowStyle?: string };

/// Measures the space that the scrollbars take in the layout, once
function measureScrollbarLayout(): ScrollbarLayout {
    if (SCROLLBAR_LAYOUT !== null) {
        return SCROLLBAR_LAYOUT;
    }

    // Creating invisible container
    const outer = document.createElement('div');
    outer.style.visibility = 'hidden';
    outer.style.overflow = 'scroll';
    (outer.style as MsOverflowStyle).msOverflowStyle = 'scrollbar';
    document.body.appendChild(outer);

    // Creating inner element and placing it in the container
    const inner = document.createElement('div');
    outer.appendChild(inner);

    // Calculating difference between container's full size and the child size
    SCROLLBAR_LAYOUT = {
        width: outer.offsetWidth - inner.offsetWidth,
        height: outer.offsetHeight - inner.offsetHeight,
    };

    // Removing temporary elements from the DOM
    outer.parentNode?.removeChild(outer);
    return SCROLLBAR_LAYOUT;
}

/// The width that a vertical scrollbar covers, also when it overlays the content
export const useScrollbarWidth = () => Math.max(measureScrollbarLayout().width, OVERLAY_SCROLLBAR_WIDTH);

/// The height that a horizontal scrollbar covers, also when it overlays the content
export const useScrollbarHeight = () => Math.max(measureScrollbarLayout().height, OVERLAY_SCROLLBAR_HEIGHT);

/// Do the scrollbars overlay the content instead of taking space in the layout, e.g. on macOS
export const useScrollbarsOverlay = () => measureScrollbarLayout().height === 0;
