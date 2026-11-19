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

/// The brand that the components show: its logo, e.g. in the placeholder of a card, and its id. The colors of a brand
/// are the tokens of its flavor stylesheet (styles/flavors), charts drawn on a canvas resolve them again when the id
/// changes.
export interface Brand {
    id: string;
    logo: BrandLogo;
}

/// The brand of DashQL
export const DASHQL_BRAND: Brand = { id: 'dashql', logo: { symbol: 'dashql', aspectRatio: 1, wordmark: false } };

/// The brand of the host, the app provides the one of its flavor
export const BrandContext = React.createContext<Brand>(DASHQL_BRAND);

/// The brand of the host
export function useBrand(): Brand {
    return React.useContext(BrandContext);
}
