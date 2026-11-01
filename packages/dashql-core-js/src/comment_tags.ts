import * as buffers from './buffers.js';

/// The prefix of comment tags, e.g. `@vis`
export const COMMENT_TAG_PREFIX = '@';
/// The tag that may close a tagged region of line comments, accepted for older scripts and never needed
export const COMMENT_TAG_END = `${COMMENT_TAG_PREFIX}end`;
/// A `@<tag>` region of comments. The parser does not interpret the content, readers pick tags by name.
export interface CommentTag {
    /// The index of the comment block in the parsed script
    blockId: number;
    /// The tag name, e.g. `vis`
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

/// A tag of the annotation of a statement. The first line is the text on the line of the tag and may be empty.
export interface AnnotationTag {
    name: string;
    lines: string[];
}

/// The annotation of a statement: the comment tags in front of it, read and written as one comment by
/// `readAnnotation` and `rewriteAnnotation` of a script or script session
export interface ScriptAnnotation {
    /// The text before the first tag of a block comment
    preamble: string[];
    /// The tags in their order
    tags: AnnotationTag[];
}

/// A tag with a text that starts on the line after the tag
export function annotationTag(name: string, text: string): AnnotationTag {
    return { name, lines: ['', ...text.split(/\r?\n/)] };
}

/// The text of a tag: its lines joined with line breaks, without an empty first line
export function annotationTagText(tag: AnnotationTag): string {
    return (tag.lines[0] === '' ? tag.lines.slice(1) : tag.lines).join('\n');
}
