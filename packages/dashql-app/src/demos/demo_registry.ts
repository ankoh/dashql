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
        description: 'A live board of trades, fed by a generator or the public feeds of Coinbase or Binance.',
        load: () => import('./stock_analysis/stock_analysis_page.js'),
    },
    {
        id: 'ui',
        title: 'UI Foundations',
        description: 'The buttons, text inputs, segmented controls and action lists of the app in their variants and sizes.',
        load: () => import('./ui/ui_page.js'),
    },
];
