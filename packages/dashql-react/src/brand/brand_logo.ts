import * as React from 'react';

/// The logo of a brand, a symbol of the SVG sprite
export interface BrandLogo {
    /// The id of the symbol in the svg sprite
    symbol: string;
    /// The width of the logo relative to its height, 1 for a square mark
    aspectRatio: number;
    /// Does the logo spell out the name? The name is then not repeated next to it
    wordmark: boolean;
}

/// The logo of DashQL
export const DASHQL_LOGO: BrandLogo = { symbol: 'dashql', aspectRatio: 1, wordmark: false };

/// The logo that the components show, e.g. in the placeholder of a card. The host provides the logo of its flavor.
export const BrandLogoContext = React.createContext<BrandLogo>(DASHQL_LOGO);

/// The logo of the host
export function useBrandLogo(): BrandLogo {
    return React.useContext(BrandLogoContext);
}
