// The tools of DashQL: pages of their own that instantiate only the parts of DashQL they need, see docs/design/tools.md.
// A tool `<id>` is the entry page `entrypoints/tools/<id>.html`, Pages serves it as `/tools/<id>`.

/// A tool, listed in the Tools tab of the internals overlay
export interface ToolEntry {
    /// The id of the tool, the name of its entry page
    id: string;
    /// The title in the list
    title: string;
    /// What the tool does, in the list
    description: string;
}

/// The tools, in the order of the list
export const TOOLS: readonly ToolEntry[] = [
    {
        id: 'unpacker',
        title: 'Unpacker',
        description: 'Drop a .dashql file and look into the tables of its Parquet files.',
    },
    {
        id: 'analyzer',
        title: 'Analyzer',
        description: 'Edit a script against a catalog and look at its tokens, its AST and its analysis.',
    },
];

/// The path of a tool on the origin of the app
export function toolPath(id: string): string {
    return `/tools/${id}`;
}
