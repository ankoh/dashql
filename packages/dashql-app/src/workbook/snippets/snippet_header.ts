import * as dashql from '@ankoh/dashql-core';

import { ConnectorType } from '../../connections/connector_info.js';
import { SNIPPET_ROOT_CONNECTORS, snippetRootIsFolder } from './snippet.js';

/// One snippet file, `<root>/<folders>/<name>.sql` with at least one folder, a leading comment describes the snippet.
/// The files of the roots with the same folders and name are the variants of one snippet. A root that is a folder of
/// the browser is part of the id, so its files are variants of nothing.
export interface SnippetFile {
    /// The path of the file, starting at its root folder
    path: string;
    /// The id of the snippet, `<category>/<name>`
    id: string;
    /// The category of the snippet, the path of its folder in the tree of the browser
    category: string;
    /// The connectors that the body of the file runs on, those of its root
    connectors: readonly ConnectorType[];
    /// The text of the file, with its description
    body: string;
}

const encoder = new TextEncoder();

/// The comments of a snippet file
interface SnippetComments {
    /// The comment tag blocks, a snippet has none
    tags: dashql.CommentTag[];
    /// The ordinary comment blocks that don't lead the file, a snippet has none
    inner: number;
    /// The number of statements
    statements: number;
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
        // The comments before the first statement describe the snippet
        const statements = reader.statementsLength();
        const bodyBegin = statements > 0 ? reader.statements(0)!.statementSpan()!.offset() : bytes.length;
        const block = new dashql.buffers.parser.CommentBlock();
        let inner = 0;
        for (let i = 0; i < reader.commentBlocksLength(); ++i) {
            reader.commentBlocks(i, block);
            if (block.blockType() === dashql.buffers.parser.CommentBlockType.COMMENT && block.textSpan()!.offset() >= bodyBegin) ++inner;
        }
        return { tags: dashql.readCommentTags(reader, bytes), inner, statements };
    } finally {
        script.destroy();
        catalog.destroy();
    }
}

/// Parse a snippet file, throws if the path or the comments are invalid
export function parseSnippetFile(core: dashql.DashQL, path: string, raw: string): SnippetFile {
    const pathMatch = /^([a-z0-9_-]+)\/((?:[a-z0-9_-]+\/)*[a-z0-9_-]+)\/([a-z0-9_-]+)\.sql$/.exec(path);
    if (pathMatch == null) {
        throw new Error(`invalid snippet path: ${path}`);
    }
    const [, root, folders, name] = pathMatch;
    const connectors = SNIPPET_ROOT_CONNECTORS.get(root);
    if (connectors === undefined) {
        throw new Error(`unknown root folder "${root}" of snippet ${path}`);
    }
    const category = snippetRootIsFolder(root) ? `${root}/${folders}` : folders;

    const bytes = encoder.encode(raw);
    const { tags, inner, statements } = readComments(core, raw, bytes);
    // The formatter of the preview moves comments within a statement, explanations belong into the description
    if (inner > 0) {
        throw new Error(`snippet ${path} has comments after its description, move them into the description`);
    }
    if (tags.length > 0) {
        throw new Error(`snippet ${path} has a @${tags[0].name} tag, snippets only have a description`);
    }
    // The description stays in the applied text, a snippet needs statements besides it
    if (statements === 0) {
        throw new Error(`snippet ${path} has no body`);
    }
    return {
        path,
        id: `${category}/${name}`,
        category,
        connectors,
        body: raw.trim(),
    };
}
