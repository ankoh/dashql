import type * as React from 'react';

// The tools of DashQL: pages of their own that instantiate only the parts of DashQL they need, see docs/design/tools.md.
// A tool `<id>` is the route `#/<id>` of the page `tools.html`.

/// A tool, listed in the Tools tab of the internals overlay and on the index of the tools page
export interface ToolEntry {
    /// The id of the tool, its route is `#/<id>`
    id: string;
    /// The title in the list
    title: string;
    /// What the tool does, in the list
    description: string;
    /// Load the page of the tool, it renders the providers of the tool
    load: () => Promise<{ default: React.ComponentType }>;
}

/// The tools, in the order of the list
export const TOOLS: readonly ToolEntry[] = [
    {
        id: 'unpacker',
        title: 'Unpacker',
        description: 'Drop a .dashql file and look into the tables of its Parquet files.',
        load: () => import('./unpacker/unpacker.js'),
    },
    {
        id: 'analyzer',
        title: 'Analyzer',
        description: 'Edit a script against a catalog and look at its tokens, its AST and its analysis.',
        load: () => import('./analyzer/analyzer.js'),
    },
];

/// The path of a tool on the origin of the app
export function toolPath(id: string): string {
    return `/tools.html#/${id}`;
}
