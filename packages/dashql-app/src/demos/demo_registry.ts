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
    {
        id: 'agent_face',
        title: 'Agent Face',
        description: 'The face of the agent that glances around and melts into the DashQL brand mark, with knobs to tune its motion.',
        load: () => import('./agent_face/agent_face_page.js'),
    },
    {
        id: 'landing_backdrop',
        title: 'Landing Backdrop',
        description: 'A sphere of dots that turns into the brand mark, the backdrop of the landing pages of the app, with knobs to tune it.',
        load: () => import('./landing_backdrop/landing_backdrop_page.js'),
    },
];
