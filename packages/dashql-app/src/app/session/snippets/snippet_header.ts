import * as dashql from '@ankoh/dashql-core';

import { ConnectorType } from '../../connections/connector_info.js';
import { SNIPPET_ENGINE_CONNECTORS } from './snippet.js';

/// The comment tag of the description of a snippet
const SNIPPET_DESCRIPTION_TAG = 'description';

/// One snippet file, `<engine>/<category>/<name>.sql`, a leading `@description` block describes the snippet.
/// The files of the engines with the same category and name are the variants of one snippet.
export interface SnippetFile {
    /// The path of the file below the snippet folder
    path: string;
    /// The id of the snippet, `<category>/<name>`
    id: string;
    /// The category of the snippet, the folder of the file
    category: string;
    /// The connectors that the body of the file runs on, those of its engine
    connectors: readonly ConnectorType[];
    /// The text of the file, with its description
    body: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/// The comment blocks of a snippet file
interface SnippetComments {
    /// The comment tag blocks, e.g. the description
    tags: dashql.CommentTag[];
    /// The number of ordinary comment blocks
    plain: number;
}

/// Read the comment blocks of a text with the DashQL parser
function readComments(core: dashql.DashQL, text: string, bytes: Uint8Array): SnippetComments {
    const catalog = core.createCatalog();
    const script = core.createScript(catalog);
    try {
        script.insertTextAt(0, text);
        script.parse();
        const parsed = script.getParsed();
        const reader = parsed.read();
        const block = new dashql.buffers.parser.CommentBlock();
        let plain = 0;
        for (let i = 0; i < reader.commentBlocksLength(); ++i) {
            if (reader.commentBlocks(i, block)!.blockType() === dashql.buffers.parser.CommentBlockType.COMMENT) ++plain;
        }
        return { tags: dashql.readCommentTags(reader, bytes), plain };
    } finally {
        script.destroy();
        catalog.destroy();
    }
}

/// Parse a snippet file, throws if the path or the comments are invalid
export function parseSnippetFile(core: dashql.DashQL, path: string, raw: string): SnippetFile {
    const pathMatch = /^([a-z0-9_-]+)\/([a-z0-9_-]+)\/([a-z0-9_-]+)\.sql$/.exec(path);
    if (pathMatch == null) {
        throw new Error(`invalid snippet path: ${path}`);
    }
    const [, engine, category, name] = pathMatch;
    const engineConnectors = SNIPPET_ENGINE_CONNECTORS.get(engine);
    if (engineConnectors === undefined) {
        throw new Error(`unknown engine folder "${engine}" of snippet ${path}`);
    }

    const bytes = encoder.encode(raw);
    const { tags, plain } = readComments(core, raw, bytes);
    // The formatter of the preview moves comments within a statement, explanations belong into the description
    if (plain > 0) {
        throw new Error(`snippet ${path} has comments outside its comment tags, move them into the description`);
    }
    const otherTag = tags.find(tag => tag.name !== SNIPPET_DESCRIPTION_TAG);
    if (otherTag != null) {
        throw new Error(`snippet ${path} has a @${otherTag.name} block, snippets only have a description`);
    }
    // The description stays in the applied text, a snippet needs statements besides it
    let statements = '';
    let end = 0;
    for (const tag of [...tags].sort((l, r) => l.offset - r.offset)) {
        statements += decoder.decode(bytes.subarray(end, tag.offset));
        end = tag.offset + tag.length;
    }
    statements += decoder.decode(bytes.subarray(end));
    if (statements.trim().length === 0) {
        throw new Error(`snippet ${path} has no body`);
    }
    return {
        path,
        id: `${category}/${name}`,
        category,
        connectors: engineConnectors,
        body: raw.trim(),
    };
}
