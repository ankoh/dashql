export interface BundledNotebook {
    id: string;
    name: string;
    manifestPath: `/static/examples/notebooks/${string}/dashql-notebook.json`;
}

export const BUNDLED_NOTEBOOKS = [
    { id: 'demo', name: 'Demo', manifestPath: '/static/examples/notebooks/demo/dashql-notebook.json' },
    { id: 'explain', name: 'Explain', manifestPath: '/static/examples/notebooks/explain/dashql-notebook.json' },
    { id: 'property-graphs', name: 'Property Graphs', manifestPath: '/static/examples/notebooks/property-graphs/dashql-notebook.json' },
    { id: 'calculated-insights', name: 'Calculated Insights', manifestPath: '/static/examples/notebooks/calculated-insights/dashql-notebook.json' },
    { id: 'transforms', name: 'Transforms', manifestPath: '/static/examples/notebooks/transforms/dashql-notebook.json' },
] as const satisfies readonly BundledNotebook[];

export function resolveBundledNotebookUrl(notebook: BundledNotebook, baseUrl: URL): URL {
    return new URL(notebook.manifestPath, baseUrl);
}

export function bundledNotebookShareUrl(notebook: BundledNotebook): string {
    const manifestUrl = resolveBundledNotebookUrl(notebook, new URL('https://dashql.app'));
    return `https://dashql.app?notebook=${encodeURIComponent(manifestUrl.toString())}`;
}
