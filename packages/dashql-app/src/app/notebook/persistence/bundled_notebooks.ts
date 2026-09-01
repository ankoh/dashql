export interface BundledNotebook {
    id: string;
    name: string;
    notebookId: string;
    manifestPath: `/static/examples/notebooks/${string}/dashql-notebook.json`;
}

export const BUNDLED_NOTEBOOKS = [
    { id: 'demo', name: 'Demo', notebookId: '92a09cb7-5f7d-4f8e-8c78-0dc39d8fff36', manifestPath: '/static/examples/notebooks/demo/dashql-notebook.json' },
    { id: 'explain', name: 'Explain', notebookId: '8203c46f-e9bd-4940-acc3-decc5d9d13a3', manifestPath: '/static/examples/notebooks/explain/dashql-notebook.json' },
    { id: 'property-graphs', name: 'Property Graphs', notebookId: 'f52ad067-c479-4c03-a07a-8edb0cb79711', manifestPath: '/static/examples/notebooks/property-graphs/dashql-notebook.json' },
    { id: 'calculated-insights', name: 'Calculated Insights', notebookId: '8e63246c-9ab9-4c9c-aa7a-f268adf3fe7b', manifestPath: '/static/examples/notebooks/calculated-insights/dashql-notebook.json' },
    { id: 'transforms', name: 'Transforms', notebookId: '07b766f9-cb22-418e-bf94-42d1ecd9b775', manifestPath: '/static/examples/notebooks/transforms/dashql-notebook.json' },
] as const satisfies readonly BundledNotebook[];

export function resolveBundledNotebookUrl(notebook: BundledNotebook, baseUrl: URL): URL {
    return new URL(notebook.manifestPath, baseUrl);
}

export function bundledNotebookShareUrl(notebook: BundledNotebook): string {
    const manifestUrl = resolveBundledNotebookUrl(notebook, new URL('https://dashql.app'));
    return `https://dashql.app?notebook=${encodeURIComponent(manifestUrl.toString())}`;
}
