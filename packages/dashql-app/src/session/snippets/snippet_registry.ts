import type * as dashql from '@ankoh/dashql-core';

import { ConnectorType } from '../../connections/connector_info.js';
import { SNIPPET_DATASETS_FOLDER, type Snippet } from './snippet.js';
import { parseSnippetFile, type SnippetFile } from './snippet_header.js';

/// The snippets of the snippet browser
export interface SnippetRegistry {
    /// The snippets, the datasets first, then ordered by path
    snippets: Snippet[];
    /// The snippets by id
    byId: ReadonlyMap<string, Snippet>;
    /// The problems of the snippet files, the affected snippets are left out
    errors: string[];
}

/// The snippet files of examples/snippets, bundled as text. The Vite config aliases the folder.
const SNIPPET_FILES = import.meta.glob<string>('@dashql/snippets/**/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
});
/// The snippet files of the extensions, `<extension>/snippets/<folders>/<name>.sql`
const EXTENSION_SNIPPET_FILES = import.meta.glob<string>('@dashql/extensions/*/snippets/**/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
});

/// The text of a snippet for a connector
export function snippetText(snippet: Snippet, connector: ConnectorType): string {
    const body = snippet.bodies.get(connector);
    if (body == null) {
        throw new Error(`snippet ${snippet.id} does not support connector ${ConnectorType[connector]}`);
    }
    return `${body}\n`;
}

/// Merge the files of one snippet, the engine variants of a snippet share its id
function mergeSnippetFiles(files: SnippetFile[]): Snippet {
    const bodies = new Map<ConnectorType, string>();
    const paths = new Map<ConnectorType, string>();
    for (const file of files) {
        for (const connector of file.connectors) {
            bodies.set(connector, file.body);
            paths.set(connector, file.path);
        }
    }
    return {
        id: files[0].id,
        category: files[0].category,
        connectors: [...bodies.keys()],
        bodies,
        paths,
    };
}

/// Compare the ids of snippets by their path segments, so that `d360` sorts before `d360-api`
function compareSnippetIds(left: string, right: string): number {
    const l = left.split('/');
    const r = right.split('/');
    for (let i = 0; i < Math.min(l.length, r.length); ++i) {
        const order = l[i].localeCompare(r[i]);
        if (order !== 0) return order;
    }
    return l.length - r.length;
}

/// Build the registry from the raw snippet files by path, starting at their root folders
export function buildSnippetRegistry(core: dashql.DashQL, rawFiles: Record<string, string>): SnippetRegistry {
    const errors: string[] = [];

    // Parse the files and group the engine variants of a snippet
    const filesById = new Map<string, SnippetFile[]>();
    for (const [path, raw] of Object.entries(rawFiles).sort(([l], [r]) => l.localeCompare(r))) {
        try {
            const file = parseSnippetFile(core, path, raw);
            const files = filesById.get(file.id) ?? [];
            files.push(file);
            filesById.set(file.id, files);
        } catch (error) {
            errors.push(String(error instanceof Error ? error.message : error));
        }
    }
    const byId = new Map([...filesById].map(([id, files]) => [id, mergeSnippetFiles(files)]));
    const datasetsFirst = (snippet: Snippet) => snippet.category === SNIPPET_DATASETS_FOLDER ? 0 : 1;
    const snippets = [...byId.values()].sort((l, r) => (datasetsFirst(l) - datasetsFirst(r)) || compareSnippetIds(l.id, r.id));
    return { snippets, byId, errors };
}

/// The bundled snippet files by path, starting at their root folders
export function bundledSnippetFiles(): Record<string, string> {
    const files: Record<string, string> = {};
    // The depth below the folders varies, and the paths of the folders differ between the dev server and a build
    const folder = '/snippets/';
    for (const [path, raw] of Object.entries(SNIPPET_FILES)) {
        files[path.slice(path.indexOf(folder) + folder.length)] = raw;
    }
    for (const [path, raw] of Object.entries(EXTENSION_SNIPPET_FILES)) {
        const begin = path.indexOf(folder);
        const extension = path.slice(path.lastIndexOf('/', begin - 1) + 1, begin);
        files[`${extension}/${path.slice(begin + folder.length)}`] = raw;
    }
    return files;
}

/// The registries of the bundled snippets by core instance
const BUNDLED_REGISTRIES = new WeakMap<dashql.DashQL, SnippetRegistry>();

/// The bundled snippets, parsed once per core instance
export function getBundledSnippets(core: dashql.DashQL): SnippetRegistry {
    let registry = BUNDLED_REGISTRIES.get(core);
    if (registry == null) {
        registry = buildSnippetRegistry(core, bundledSnippetFiles());
        BUNDLED_REGISTRIES.set(core, registry);
    }
    return registry;
}

/// Does a snippet run on a connector?
export function snippetSupports(snippet: Snippet, connector: ConnectorType): boolean {
    return snippet.bodies.has(connector);
}

/// The snippets that run on a connector, in the order of the registry
export function snippetsForConnector(registry: SnippetRegistry, connector: ConnectorType): Snippet[] {
    return registry.snippets.filter(snippet => snippetSupports(snippet, connector));
}
