export interface BundledNotebook {
    id: string;
    name: string;
    manifestPath: `/static/examples/notebooks/${string}/dashql-notebook.json`;
}

export const BUNDLED_NOTEBOOKS = [
    { id: 'explain', name: 'Explain', manifestPath: '/static/examples/notebooks/explain/dashql-notebook.json' },
    { id: 'property-graphs', name: 'Property Graphs', manifestPath: '/static/examples/notebooks/property-graphs/dashql-notebook.json' },
    { id: 'hello-docker', name: 'Hello Docker', manifestPath: '/static/examples/notebooks/hello-docker/dashql-notebook.json' },
    { id: 'hello-wasm', name: 'Hello WASM', manifestPath: '/static/examples/notebooks/hello-wasm/dashql-notebook.json' },
] as const satisfies readonly BundledNotebook[];

export function resolveBundledNotebookUrl(notebook: BundledNotebook, baseUrl: URL): URL {
    return new URL(notebook.manifestPath, baseUrl);
}

export function bundledNotebookShareUrl(notebook: BundledNotebook): string {
    const manifestUrl = resolveBundledNotebookUrl(notebook, new URL('https://dashql.app'));
    return `https://dashql.app?notebook=${encodeURIComponent(manifestUrl.toString())}`;
}
