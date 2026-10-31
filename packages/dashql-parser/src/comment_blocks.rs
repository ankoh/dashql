//! Grouping comments into blocks.
//!
//! A block is either a single block comment or a run of line comments that start their own lines on
//! consecutive lines. A trailing line comment (`select 1; -- note`) is a block of its own.
//!
//! Comments are split into tagged blocks at every line whose first text is a known tag, `@<tag>`
//! (see [`COMMENT_TAGS`]). Any other `@word` is ordinary text. A tag runs to the next tag line or to
//! the end of the comment, like the block tags of Javadoc: in a block comment the comment end closes the
//! last tag, in a run of line comments the end of the run. Text before the first tag of a block comment
//! is an ordinary block. Older scripts close the last region of line comments with `-- @end`, the line is
//! still accepted and ends the region, comments after it are ordinary comments.
//!
//! The content lines omit comment markers, block comment gutters (` * `), tag lines and leading or
//! trailing empty lines. Text following the opening tag on the same line is content. The parser does
//! not interpret the content, readers pick blocks by tag name and parse the content themselves, e.g.
//! as JSON.

use crate::span::TextSpan;
pub use dashql_buffers::parser::CommentBlockType;

/// The prefix of comment tags, e.g. `-- @description`
pub const COMMENT_TAG_PREFIX: &str = "@";
/// The tag that may close a tagged region of line comments, accepted for older scripts and never needed
pub const COMMENT_TAG_END: &str = "end";
/// The known tags, any other `@word` is ordinary text
pub const COMMENT_TAGS: &[&str] = &["metadata", "description", "vis", COMMENT_TAG_END];

/// Is a tag name one of the known tags?
pub fn is_comment_tag(name: &[u8]) -> bool {
    COMMENT_TAGS.iter().any(|t| t.as_bytes() == name)
}

/// A block of comments
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CommentBlock {
    /// The kind of block: an ordinary comment or a `@<tag>` region
    pub block_type: CommentBlockType,
    /// The whole block, including comment markers and tag lines
    pub text_span: TextSpan,
    /// The tag name (e.g. `description`), empty for ordinary comments
    pub tag_span: TextSpan,
    /// Slice of the comments of the script
    pub comments_begin: u32,
    /// The number of comments in the block
    pub comments_count: u32,
    /// Slice of [`CommentBlocks::lines`]
    pub lines_begin: u32,
    /// The number of content lines of the block
    pub lines_count: u32,
}

/// The comments of a script grouped into blocks
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CommentBlocks {
    /// The blocks in script order
    pub blocks: Vec<CommentBlock>,
    /// The content lines of all blocks
    pub lines: Vec<TextSpan>,
    /// Malformed comment tags
    pub warnings: Vec<(TextSpan, String)>,
}

/// Group comments into blocks.
pub fn group_comments(text: &str, comments: &[TextSpan]) -> CommentBlocks {
    group_comment_bytes(text.as_bytes(), comments)
}

/// Group comments into blocks, for callers that hold the script text as bytes
pub fn group_comment_bytes(text: &[u8], comments: &[TextSpan]) -> CommentBlocks {
    let mut grouper = Grouper {
        text,
        comments,
        out: CommentBlocks::default(),
    };
    grouper.group();
    grouper.out
}

/// Whitespace within a line
fn is_horizontal_space(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\r' | b'\x0c' | b'\x0b')
}

/// A byte range [begin, end) in the script text
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Range {
    /// The first byte offset
    begin: usize,
    /// The byte offset past the end
    end: usize,
}

impl Range {
    fn new(begin: usize, end: usize) -> Self {
        Self { begin, end }
    }
    fn is_empty(&self) -> bool {
        self.begin >= self.end
    }
    fn span(&self) -> TextSpan {
        TextSpan::new(self.begin as u32, self.end.saturating_sub(self.begin) as u32)
    }
}

/// A comment tag at the start of a line
struct Tag {
    /// The tag name
    name: Range,
    /// The text following the tag on the same line
    rest: Range,
}

/// Groups the comments of a script into blocks
struct Grouper<'a> {
    /// The script text
    text: &'a [u8],
    /// The comments of the script in script order
    comments: &'a [TextSpan],
    /// The comment blocks built so far
    out: CommentBlocks,
}

impl<'a> Grouper<'a> {
    fn slice(&self, r: Range) -> &'a [u8] {
        &self.text[r.begin..r.end.max(r.begin)]
    }

    /// Trim horizontal whitespace on both sides
    fn trim(&self, mut r: Range) -> Range {
        while r.begin < r.end && is_horizontal_space(self.text[r.begin]) {
            r.begin += 1;
        }
        while r.end > r.begin && is_horizontal_space(self.text[r.end - 1]) {
            r.end -= 1;
        }
        r
    }

    /// Read a tag from trimmed line content
    fn read_tag(&self, line: Range) -> Option<Tag> {
        if !self.slice(line).starts_with(COMMENT_TAG_PREFIX.as_bytes()) {
            return None;
        }
        let name_begin = line.begin + COMMENT_TAG_PREFIX.len();
        let mut name_end = name_begin;
        while name_end < line.end {
            let c = self.text[name_end];
            if !(c.is_ascii_alphanumeric() || c == b'_' || c == b'-') {
                break;
            }
            name_end += 1;
        }
        // The tag name must be followed by whitespace or the end of the line
        if name_end == name_begin || (name_end < line.end && !is_horizontal_space(self.text[name_end])) {
            return None;
        }
        if !is_comment_tag(&self.text[name_begin..name_end]) {
            return None;
        }
        Some(Tag {
            name: Range::new(name_begin, name_end),
            rest: self.trim(Range::new(name_end, line.end)),
        })
    }

    /// Is a comment the first text on its line?
    fn starts_line(&self, mut offset: usize) -> bool {
        while offset > 0 && is_horizontal_space(self.text[offset - 1]) {
            offset -= 1;
        }
        offset == 0 || self.text[offset - 1] == b'\n'
    }

    /// Is the gap between two line comments only whitespace with a single line break?
    fn is_contiguous_gap(&self, begin: usize, end: usize) -> bool {
        let mut line_breaks = 0;
        for &c in &self.text[begin..end] {
            if c == b'\n' {
                line_breaks += 1;
            } else if !is_horizontal_space(c) {
                return false;
            }
        }
        line_breaks <= 1
    }

    fn is_line_comment(&self, comment: TextSpan) -> bool {
        comment.length >= 2 && self.text[comment.offset as usize..].starts_with(b"--")
    }

    /// The content of a line comment: everything after the dashes and a single space
    fn line_comment_content(&self, comment: TextSpan) -> Range {
        let mut begin = comment.offset as usize;
        let mut end = comment.end() as usize;
        while begin < end && self.text[begin] == b'-' {
            begin += 1;
        }
        if begin < end && self.text[begin] == b' ' {
            begin += 1;
        }
        while end > begin && is_horizontal_space(self.text[end - 1]) {
            end -= 1;
        }
        Range::new(begin, end)
    }

    /// The content lines of a block comment without delimiters and gutters.
    ///
    /// A gutter (` * `) is stripped if every line after the first has one. The lines after the first lose
    /// their common indentation, so relative indentation (e.g. of a Markdown list) is kept.
    fn block_comment_lines(&self, comment: TextSpan) -> Vec<Range> {
        let mut begin = comment.offset as usize;
        let mut end = comment.end() as usize;
        // Strip `*/`, the scanner reports unterminated block comments as errors
        if comment.length >= 4 && &self.text[end - 2..end] == b"*/" {
            end -= 2;
        }
        // Strip `/*` and additional stars, as in `/**`
        begin = (begin + 2).min(end);
        while begin < end && self.text[begin] == b'*' {
            begin += 1;
        }
        while end > begin && self.text[end - 1] == b'*' {
            end -= 1;
        }
        let mut lines = Vec::new();
        let mut line_begin = begin;
        for i in begin..=end {
            if i < end && self.text[i] != b'\n' {
                continue;
            }
            lines.push(Range::new(line_begin, i));
            line_begin = i + 1;
        }
        let first_text = |r: Range| {
            let t = self.trim(r);
            (!t.is_empty()).then_some(t.begin)
        };
        let has_gutter = lines.len() > 1
            && lines[1..].iter().any(|&l| first_text(l).is_some())
            && lines[1..].iter().all(|&l| first_text(l).is_none_or(|b| self.text[b] == b'*'));
        if has_gutter {
            for line in &mut lines[1..] {
                if let Some(star) = first_text(*line) {
                    line.begin = star + 1;
                    if line.begin < line.end && self.text[line.begin] == b' ' {
                        line.begin += 1;
                    }
                }
            }
        }
        // Remove the common indentation of the lines after the first
        let indent = |r: Range| self.text[r.begin..r.end].iter().take_while(|&&c| is_horizontal_space(c)).count();
        let common = lines[1..].iter().filter(|&&l| first_text(l).is_some()).map(|&l| indent(l)).min().unwrap_or(0);
        for (i, line) in lines.iter_mut().enumerate() {
            let mut r = if i == 0 || first_text(*line).is_none() {
                self.trim(*line)
            } else {
                Range::new(line.begin + common, line.end)
            };
            while r.end > r.begin && is_horizontal_space(self.text[r.end - 1]) {
                r.end -= 1;
            }
            *line = r;
        }
        lines
    }

    fn warn(&mut self, span: TextSpan, message: String) {
        self.out.warnings.push((span, message));
    }

    /// Emit a block that spans whole comments, leading and trailing empty lines are dropped
    fn emit(&mut self, block_type: CommentBlockType, comments_begin: usize, comments_end: usize, tag: Range, lines: &[Range]) {
        let first = self.comments[comments_begin];
        let last = self.comments[comments_end - 1];
        let text_span = TextSpan::new(first.offset, last.end() - first.offset);
        self.emit_span(block_type, comments_begin, comments_end, text_span, tag, lines);
    }

    /// Emit a block with an explicit text span, e.g. a part of a block comment
    fn emit_span(
        &mut self,
        block_type: CommentBlockType,
        comments_begin: usize,
        comments_end: usize,
        text_span: TextSpan,
        tag: Range,
        mut lines: &[Range],
    ) {
        while lines.first().is_some_and(Range::is_empty) {
            lines = &lines[1..];
        }
        while lines.last().is_some_and(Range::is_empty) {
            lines = &lines[..lines.len() - 1];
        }
        self.out.blocks.push(CommentBlock {
            block_type,
            text_span,
            tag_span: tag.span(),
            comments_begin: comments_begin as u32,
            comments_count: (comments_end - comments_begin) as u32,
            lines_begin: self.out.lines.len() as u32,
            lines_count: lines.len() as u32,
        });
        self.out.lines.extend(lines.iter().map(Range::span));
    }

    /// Is a tag the end tag?
    fn is_end(&self, tag: &Tag) -> bool {
        self.slice(tag.name) == COMMENT_TAG_END.as_bytes()
    }

    fn group_block_comment(&mut self, comment_id: usize) {
        let comment = self.comments[comment_id];
        let mut lines = self.block_comment_lines(comment);
        // Every tag line starts a tagged block, the end tag is never needed in a block comment
        let mut tags: Vec<(usize, Tag)> = Vec::new();
        for (i, &line) in lines.iter().enumerate() {
            let Some(tag) = self.read_tag(self.trim(line)) else { continue };
            if self.is_end(&tag) {
                self.warn(TextSpan::new(line.begin as u32, (line.end - line.begin) as u32), "@end without an opening tag".to_string());
                continue;
            }
            tags.push((i, tag));
        }
        if tags.is_empty() {
            self.emit(CommentBlockType::COMMENT, comment_id, comment_id + 1, Range::default(), &lines);
            return;
        }
        // Text before the first tag is an ordinary block
        let first_tag = tags[0].0;
        let mut span_begin = comment.offset as usize;
        if lines[..first_tag].iter().any(|l| !l.is_empty()) {
            let tag_begin = tags[0].1.name.begin - COMMENT_TAG_PREFIX.len();
            let span = Range::new(span_begin, tag_begin).span();
            self.emit_span(CommentBlockType::COMMENT, comment_id, comment_id + 1, span, Range::default(), &lines[..first_tag]);
            span_begin = tag_begin;
        }
        for k in 0..tags.len() {
            let (line, ref tag) = tags[k];
            let (lines_end, span_end) = match tags.get(k + 1) {
                Some((next, next_tag)) => (*next, next_tag.name.begin - COMMENT_TAG_PREFIX.len()),
                None => (lines.len(), comment.end() as usize),
            };
            let name = tag.name;
            lines[line] = tag.rest;
            let span = Range::new(span_begin, span_end).span();
            self.emit_span(CommentBlockType::DASHQL_TAG, comment_id, comment_id + 1, span, name, &lines[line..lines_end]);
            span_begin = span_end;
        }
    }

    fn group_line_comments(&mut self, run_begin: usize, run_end: usize) {
        let lines: Vec<Range> = (run_begin..run_end).map(|i| self.line_comment_content(self.comments[i])).collect();
        let line = |i: usize| lines[i - run_begin];
        // The comments of the run that are not yet emitted
        let mut pending = run_begin;
        let mut i = run_begin;
        while i < run_end {
            let Some(tag) = self.read_tag(self.trim(line(i))) else {
                i += 1;
                continue;
            };
            if self.is_end(&tag) {
                self.warn(self.comments[i], "@end without an opening tag".to_string());
                i += 1;
                continue;
            }
            // A region ends at the next tag line, at an end line or at the end of the run
            let mut close = i + 1;
            let mut closed_by_end = false;
            while close < run_end {
                if let Some(next) = self.read_tag(self.trim(line(close))) {
                    if !self.is_end(&next) {
                        break;
                    }
                    if next.rest.is_empty() {
                        closed_by_end = true;
                        break;
                    }
                }
                close += 1;
            }
            if pending < i {
                self.emit(CommentBlockType::COMMENT, pending, i, Range::default(), &lines[pending - run_begin..i - run_begin]);
            }
            let mut content = Vec::with_capacity(close - i);
            content.push(tag.rest);
            content.extend((i + 1..close).map(line));
            let region_end = if closed_by_end { close + 1 } else { close };
            self.emit(CommentBlockType::DASHQL_TAG, i, region_end, tag.name, &content);
            pending = region_end;
            i = region_end;
        }
        if pending < run_end {
            self.emit(CommentBlockType::COMMENT, pending, run_end, Range::default(), &lines[pending - run_begin..]);
        }
    }

    fn group(&mut self) {
        let mut i = 0;
        while i < self.comments.len() {
            let comment = self.comments[i];
            if !self.is_line_comment(comment) {
                self.group_block_comment(i);
                i += 1;
                continue;
            }
            // A trailing line comment is a block of its own
            let mut run_end = i + 1;
            if self.starts_line(comment.offset as usize) {
                while run_end < self.comments.len() {
                    let prev = self.comments[run_end - 1];
                    let next = self.comments[run_end];
                    if !self.is_line_comment(next)
                        || !self.is_contiguous_gap(prev.end() as usize, next.offset as usize)
                        || !self.starts_line(next.offset as usize)
                    {
                        break;
                    }
                    run_end += 1;
                }
            }
            self.group_line_comments(i, run_end);
            i = run_end;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scanner::scan;

    fn group(text: &str) -> CommentBlocks {
        let scanned = scan(text, 0, 0);
        group_comments(text, &scanned.comments)
    }

    fn line_texts(text: &str, blocks: &CommentBlocks, block: usize) -> Vec<String> {
        let b = blocks.blocks[block];
        blocks.lines[b.lines_begin as usize..(b.lines_begin + b.lines_count) as usize]
            .iter()
            .map(|l| text[l.offset as usize..l.end() as usize].to_string())
            .collect()
    }

    #[test]
    fn groups_line_comments() {
        let text = "-- a\n-- b\nselect 1; -- trailing\n\n-- c";
        let blocks = group(text);
        assert_eq!(blocks.blocks.len(), 3);
        assert_eq!(line_texts(text, &blocks, 0), vec!["a", "b"]);
        assert_eq!(line_texts(text, &blocks, 1), vec!["trailing"]);
        assert_eq!(line_texts(text, &blocks, 2), vec!["c"]);
    }

    fn tags<'a>(text: &'a str, blocks: &CommentBlocks) -> Vec<(CommentBlockType, &'a str)> {
        blocks
            .blocks
            .iter()
            .map(|b| (b.block_type, &text[b.tag_span.offset as usize..b.tag_span.end() as usize]))
            .collect()
    }

    fn block_texts<'a>(text: &'a str, blocks: &CommentBlocks) -> Vec<&'a str> {
        blocks.blocks.iter().map(|b| &text[b.text_span.offset as usize..b.text_span.end() as usize]).collect()
    }

    #[test]
    fn reads_tagged_regions() {
        let text = "-- @description Sales\n-- per region\n-- @end\n/* @metadata {\"a\": 1} */\n/* @vis table */";
        let blocks = group(text);
        assert_eq!(
            tags(text, &blocks),
            vec![
                (CommentBlockType::DASHQL_TAG, "description"),
                (CommentBlockType::DASHQL_TAG, "metadata"),
                (CommentBlockType::DASHQL_TAG, "vis"),
            ]
        );
        assert_eq!(line_texts(text, &blocks, 0), vec!["Sales", "per region"]);
        // The content is not interpreted, readers check whether it is JSON
        assert_eq!(line_texts(text, &blocks, 1), vec!["{\"a\": 1}"]);
        assert_eq!(line_texts(text, &blocks, 2), vec!["table"]);
        assert!(blocks.warnings.is_empty());
    }

    #[test]
    fn ignores_unknown_tags() {
        let text = "-- @todo fix this\n-- @param x\n/* @param x */";
        let blocks = group(text);
        assert_eq!(tags(text, &blocks), vec![(CommentBlockType::COMMENT, ""), (CommentBlockType::COMMENT, "")]);
        assert!(blocks.warnings.is_empty());
    }

    #[test]
    fn splits_block_comments_at_tags() {
        let text = "/* Sales.\n   @description Revenue.\n   @vis card width=6\n   @vis vegalite\n   {\"mark\": \"bar\"}\n*/";
        let blocks = group(text);
        assert_eq!(
            tags(text, &blocks),
            vec![
                (CommentBlockType::COMMENT, ""),
                (CommentBlockType::DASHQL_TAG, "description"),
                (CommentBlockType::DASHQL_TAG, "vis"),
                (CommentBlockType::DASHQL_TAG, "vis"),
            ]
        );
        assert_eq!(line_texts(text, &blocks, 0), vec!["Sales."]);
        assert_eq!(line_texts(text, &blocks, 1), vec!["Revenue."]);
        assert_eq!(line_texts(text, &blocks, 2), vec!["card width=6"]);
        assert_eq!(line_texts(text, &blocks, 3), vec!["vegalite", "{\"mark\": \"bar\"}"]);
        // The blocks cover the comment without gaps
        assert_eq!(block_texts(text, &blocks).concat(), text);
        assert!(blocks.blocks.iter().all(|b| (b.comments_begin, b.comments_count) == (0, 1)));
    }

    #[test]
    fn splits_line_comments_at_tags() {
        let text = "-- @description Revenue.\n-- @vis card width=6\n-- @vis table\n-- @end";
        let blocks = group(text);
        assert_eq!(
            tags(text, &blocks),
            vec![
                (CommentBlockType::DASHQL_TAG, "description"),
                (CommentBlockType::DASHQL_TAG, "vis"),
                (CommentBlockType::DASHQL_TAG, "vis"),
            ]
        );
        assert_eq!(line_texts(text, &blocks, 1), vec!["card width=6"]);
        assert_eq!(block_texts(text, &blocks), vec!["-- @description Revenue.", "-- @vis card width=6", "-- @vis table\n-- @end"]);
        assert!(blocks.warnings.is_empty());
    }

    #[test]
    fn keeps_relative_indentation_in_block_comments() {
        let text = "/* @vis markdown\n     - a\n       - b\n\n     * c\n*/";
        let blocks = group(text);
        assert_eq!(line_texts(text, &blocks, 0), vec!["markdown", "- a", "  - b", "", "* c"]);
        let text = "/**\n * @description\n *   indented\n * plain\n */";
        let blocks = group(text);
        assert_eq!(line_texts(text, &blocks, 0), vec!["  indented", "plain"]);
    }

    #[test]
    fn warns_about_end_tags_without_a_region() {
        // A blank line ends the run of line comments and the region, the end line after it closes nothing
        let text = "-- @description\n-- x\n\n-- @end\n/* @end */";
        let blocks = group(text);
        let warnings: Vec<&str> = blocks.warnings.iter().map(|w| w.1.as_str()).collect();
        assert_eq!(warnings, vec!["@end without an opening tag", "@end without an opening tag"]);
        assert_eq!(
            tags(text, &blocks),
            vec![(CommentBlockType::DASHQL_TAG, "description"), (CommentBlockType::COMMENT, ""), (CommentBlockType::COMMENT, "")]
        );
    }

    #[test]
    fn closes_the_last_region_at_the_end_of_the_run() {
        let text = "-- @description Revenue.\n-- per region\n-- @vis table\nselect 1";
        let blocks = group(text);
        assert_eq!(tags(text, &blocks), vec![(CommentBlockType::DASHQL_TAG, "description"), (CommentBlockType::DASHQL_TAG, "vis")]);
        assert_eq!(line_texts(text, &blocks, 0), vec!["Revenue.", "per region"]);
        assert_eq!(line_texts(text, &blocks, 1), vec!["table"]);
        assert!(blocks.warnings.is_empty());
        // An end line still closes the region, comments after it are ordinary
        let text = "-- @description Revenue.\n-- @end\n-- note";
        let blocks = group(text);
        assert_eq!(tags(text, &blocks), vec![(CommentBlockType::DASHQL_TAG, "description"), (CommentBlockType::COMMENT, "")]);
        assert_eq!(block_texts(text, &blocks), vec!["-- @description Revenue.\n-- @end", "-- note"]);
        assert!(blocks.warnings.is_empty());
    }
}
