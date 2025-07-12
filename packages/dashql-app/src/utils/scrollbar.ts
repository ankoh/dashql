let SCROLLBAR_WIDTH: number | null = null;
let SCROLLBAR_HEIGHT: number | null = null;

// Kudos to: https://www.robinwieruch.de/react-hook-scrollbar-width/

export const useScrollbarWidth = () => {
    if (SCROLLBAR_WIDTH !== null) {
        return SCROLLBAR_WIDTH;
    }

    // Creating invisible container
    const outer = document.createElement('div');
    outer.style.visibility = 'hidden';
    outer.style.overflow = 'scroll';
    (outer.style as any).msOverflowStyle = 'scrollbar';
    document.body.appendChild(outer);

    // Creating inner element and placing it in the container
    const inner = document.createElement('div');
    outer.appendChild(inner);

    // Calculating difference between container's full width and the child width
    SCROLLBAR_WIDTH = outer.offsetWidth - inner.offsetWidth;

    // Removing temporary elements from the DOM
    outer.parentNode?.removeChild(outer);
    return SCROLLBAR_WIDTH;
};

export const useScrollbarHeight = () => {
    if (SCROLLBAR_HEIGHT !== null) {
        return SCROLLBAR_HEIGHT;
    }

    // Creating invisible container
    const outer = document.createElement('div');
    outer.style.visibility = 'hidden';
    outer.style.overflow = 'scroll';
    (outer.style as any).msOverflowStyle = 'scrollbar';
    document.body.appendChild(outer);

    // Creating inner element and placing it in the container
    const inner = document.createElement('div');
    outer.appendChild(inner);

    // Calculating difference between container's full height and the child height
    SCROLLBAR_HEIGHT = outer.offsetHeight - inner.offsetHeight;

    // Removing temporary elements from the DOM
    outer.parentNode?.removeChild(outer);
    return SCROLLBAR_HEIGHT;
};
