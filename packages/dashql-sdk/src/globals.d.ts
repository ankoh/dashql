// The SDK compiles against the WebWorker lib of TypeScript: the APIs that browsers share with workers, most of which
// Node has as well (fetch, AbortController, URL, TextEncoder, crypto, Blob, structuredClone). There is no window, no
// document and no element. The bundler features that the SDK still uses are declared here, each is a known seam of
// test/boundary_test.mjs that step 4 of docs/wip/dashql_sdk.md removes.

/// A text asset, e.g. `./functions.sql?raw`
declare module '*?raw' {
    const text: string;
    export default text;
}

interface ImportMeta {
    /// The modules that match a pattern, each loaded on demand
    glob<T = unknown>(pattern: string | string[], options?: { import?: string; query?: string }): Record<string, () => Promise<T>>;
}
