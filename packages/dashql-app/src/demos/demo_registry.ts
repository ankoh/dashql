import type * as React from 'react';

/// A demo of the demos page, a page of its own that is loaded when it is opened
export interface DemoEntry {
    /// The id of the demo, its route is `#/<id>`
    id: string;
    /// The title in the index
    title: string;
    /// What the demo shows, in the index
    description: string;
    /// Load the page of the demo
    load: () => Promise<{ default: React.ComponentType }>;
}

/// The demos, in the order of the index
export const DEMOS: readonly DemoEntry[] = [
    {
        id: 'stock_analysis',
        title: 'Stock Analysis',
        description: 'A live board of trades. HyperDB WASM ingests a generated or the public Coinbase feed, or the board reads a remote Hyper.',
        load: () => import('./stock_analysis/stock_analysis_page.js'),
    },
];
