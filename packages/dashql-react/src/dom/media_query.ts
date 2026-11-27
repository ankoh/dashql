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

/// A phone, or a window as narrow as one
export const PHONE_WIDTH_QUERY = '(max-width: 600px)';
