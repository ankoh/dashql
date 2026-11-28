import * as React from 'react';

/// Does the window match a media query? Follows the query as the window changes.
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = React.useState(() => window.matchMedia?.(query).matches ?? false);
    React.useEffect(() => {
        const media = window.matchMedia?.(query);
        if (media == null) return;
        const update = () => setMatches(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, [query]);
    return matches;
}

// The width classes of a window (docs/design/narrow_layouts.md), the stylesheets use the same numbers: compact below
// 840px, expanded from 840px.
/// The width where the expanded class starts
export const EXPANDED_WIDTH = 840;
/// A container as narrow as a phone, e.g. a canvas that lays itself out for the width it has
export const NARROW_CONTAINER_WIDTH = 600;
/// A phone or a small tablet, or a window as narrow as one: one pane at a time, the views in a tab bar
export const COMPACT_WIDTH_QUERY = `(max-width: ${EXPANDED_WIDTH - 1}px)`;
/// A window wide enough for the panes next to each other, e.g. the workbench next to the workbook
export const EXPANDED_WIDTH_QUERY = `(min-width: ${EXPANDED_WIDTH}px)`;
