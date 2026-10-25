import * as buffers from './buffers.js';

/// The prefix of comment tags, e.g. `@dashql:description`
export const COMMENT_TAG_PREFIX = '@dashql:';
/// The tag that closes a tagged region of line comments
export const COMMENT_TAG_END = `${COMMENT_TAG_PREFIX}end`;
/// The tag of the metadata of a script, a JSON object
export const METADATA_TAG = 'metadata';

/// User-provided metadata of a script, the JSON object of its first `@dashql:metadata` block
export type ScriptMetadata = Record<string, unknown>;

/// A `@dashql:<tag>` region of comments. The parser does not interpret tags, readers pick them by name.
export interface CommentTag {
    /// The index of the comment block in the parsed script
    blockId: number;
    /// The tag name, e.g. `description`
    name: string;
    /// The content lines of the block joined with line breaks
    text: string;
    /// The byte offset of the block in the script text, including comment markers and tag lines
    offset: number;
    /// The byte length of the block
    length: number;
}

const decoder = new TextDecoder();

/// Read the tagged comment blocks of a parsed script, optionally within a slice of the comment blocks.
/// `bytes` is the UTF-8 encoded script text.
export function readCommentTags(
    parsed: buffers.parser.ParsedScript,
    bytes: Uint8Array,
    blocksBegin = 0,
    blocksCount = parsed.commentBlocksLength() - blocksBegin,
): CommentTag[] {
    const tags: CommentTag[] = [];
    const block = new buffers.parser.CommentBlock();
    const line = new buffers.parser.TextSpan();
    const end = Math.min(blocksBegin + blocksCount, parsed.commentBlocksLength());
    for (let blockId = blocksBegin; blockId < end; ++blockId) {
        parsed.commentBlocks(blockId, block);
        if (block.blockType() !== buffers.parser.CommentBlockType.DASHQL_TAG) {
            continue;
        }
        const lines: string[] = [];
        for (let i = 0; i < block.linesCount(); ++i) {
            parsed.commentLines(block.linesBegin() + i, line);
            lines.push(decoder.decode(bytes.subarray(line.offset(), line.offset() + line.length())));
        }
        // Spans nested in a struct are never null
        const tagSpan = block.tagSpan()!;
        const textSpan = block.textSpan()!;
        tags.push({
            blockId,
            name: decoder.decode(bytes.subarray(tagSpan.offset(), tagSpan.offset() + tagSpan.length())),
            text: lines.join('\n'),
            offset: textSpan.offset(),
            length: textSpan.length(),
        });
    }
    return tags;
}

/// Read the tagged comment blocks among the description comments of a statement
export function readStatementCommentTags(parsed: buffers.parser.ParsedScript, bytes: Uint8Array, statementId: number): CommentTag[] {
    const statement = parsed.statements(statementId);
    if (statement == null) {
        return [];
    }
    return readCommentTags(parsed, bytes, statement.descriptionBlocksBegin(), statement.descriptionBlocksCount());
}

/// The content of a tag as JSON object, null if the content is not a JSON object
export function parseCommentTagObject(tag: CommentTag): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(tag.text);
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

/// Read the metadata of a parsed script, the first `@dashql:metadata` block.
/// Returns null if the script has no metadata block or if its content is not a JSON object.
export function readMetadata(parsed: buffers.parser.ParsedScript, bytes: Uint8Array): ScriptMetadata | null {
    const tag = readCommentTags(parsed, bytes).find(tag => tag.name === METADATA_TAG);
    return tag == null ? null : parseCommentTagObject(tag);
}

/// Render a tagged region of line comments, without a trailing line break
export function renderCommentTag(name: string, text: string, eol = '\n'): string {
    const lines = [`${COMMENT_TAG_PREFIX}${name}`, ...text.split(/\r?\n/), COMMENT_TAG_END];
    return lines.map(l => `-- ${l}`).join(eol);
}

/// Render a metadata block as line comments, without a trailing line break.
/// The metadata is pretty-printed JSON. JSON strings never contain raw line breaks, so no value can close the
/// block early. The line form is used since a `*/` within a string would end a block comment.
export function renderMetadataBlock(metadata: ScriptMetadata, eol = '\n'): string {
    return renderCommentTag(METADATA_TAG, JSON.stringify(metadata, null, 2), eol);
}
