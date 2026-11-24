//! The Markdown renderer spec: a row template with `{{field}}` placeholders compiled into a safe, renderer-neutral
//! document tree.
//!
//! The fields are replaced by unique tokens, the template is parsed as CommonMark with pulldown-cmark, and the tokens
//! are turned into field nodes again. Raw HTML is dropped, links and images with unsafe URLs or with fields in their
//! URLs become plain spans without URL and title. Titles and code languages with fields are left out, so no token
//! reaches the document outside a field node. Adjacent text is merged into one text node, soft line breaks are text
//! (`\n`).

use crate::analyzer::types::VisualizationSpec;
use dashql_buffers::visualization::{MarkdownNodeT, MarkdownNodeType, MarkdownSpecT};
use pulldown_cmark::{CodeBlockKind, Event, LinkType, Parser, Tag, TagEnd};

/// A node of a compiled document. Empty strings are not set.
#[derive(Clone, Debug, PartialEq)]
pub struct MarkdownNode {
    /// The node type
    pub node_type: MarkdownNodeType,
    /// The text of a text node or the field name of a field node
    pub value: String,
    /// The URL of a link or image
    pub url: String,
    /// The title of a link or image, empty if it contains a field
    pub title: String,
    /// The language of a fenced code block, the first word of its info string, empty if it contains a field
    pub language: String,
    /// The level of a heading
    pub level: u8,
    /// The number of the first item of an ordered list
    pub start: u32,
    /// Is the list ordered?
    pub ordered: bool,
    /// Is the list tight, its items not wrapped in paragraphs?
    pub tight: bool,
    /// The child nodes
    pub children: Vec<MarkdownNode>,
}

impl MarkdownNode {
    pub fn new(node_type: MarkdownNodeType) -> Self {
        Self {
            node_type,
            value: String::new(),
            url: String::new(),
            title: String::new(),
            language: String::new(),
            level: 0,
            start: 0,
            ordered: false,
            tight: false,
            children: Vec::new(),
        }
    }

    fn leaf(node_type: MarkdownNodeType, value: &str) -> Self {
        Self { value: value.to_string(), ..Self::new(node_type) }
    }
}

/// A compiled Markdown spec
#[derive(Clone, Debug, PartialEq)]
pub struct MarkdownDocument {
    /// The row template
    pub template: String,
    /// The distinct field names in order of appearance
    pub fields: Vec<String>,
    /// The document tree, a DOCUMENT node
    pub document: MarkdownNode,
}

/// A field of the template and the token that stands for it in the parsed Markdown
struct MarkdownField {
    /// The field name between the braces, trimmed
    name: String,
    /// The unique token that replaces the placeholder
    token: String,
}

/// A `{{field}}` placeholder of a Markdown template
pub(crate) struct MarkdownPlaceholder<'a> {
    /// The byte range of the placeholder in the template, from its `{{` to its `}}`
    pub range: std::ops::Range<usize>,
    /// The field name between the braces, trimmed
    pub name: &'a str,
}

/// The `{{field}}` placeholders of a Markdown template
///
/// A placeholder is `{{`, a name without braces and `}}`. Of more opening braces, the last two open the placeholder
/// and the others stay text, so `{{{a}}}` is the field `a` in braces. A backslash escapes the first brace as in
/// CommonMark, so `\{{a}}` is no placeholder and reads `{{a}}`. Braces that form no placeholder stay text.
pub(crate) fn markdown_placeholders(template: &str) -> Vec<MarkdownPlaceholder<'_>> {
    let mut placeholders = Vec::new();
    let mut pos = 0;
    while let Some(open) = template.get(pos..).and_then(|rest| rest.find("{{")).map(|at| pos + at) {
        let (before, from_open) = template.split_at_checked(open).unwrap_or_default();
        let after_open = from_open.trim_start_matches('{');
        let name_begin = open + from_open.len() - after_open.len();
        // An odd number of backslashes escapes the first brace, CommonMark removes the backslash
        let escaped = (before.len() - before.trim_end_matches('\\').len()) % 2;
        let Some((inner, _)) = after_open.split_once("}}") else {
            break;
        };
        let name = inner.trim_matches([' ', '\n']);
        if name_begin - open - escaped < 2 || name.is_empty() || name.contains(['{', '}']) {
            pos = name_begin;
            continue;
        }
        let end = name_begin + inner.len() + 2;
        placeholders.push(MarkdownPlaceholder { range: name_begin - 2..end, name });
        pos = end;
    }
    placeholders
}

/// Replace `{{field}}` placeholders with tokens that do not occur in the template
fn tokenize_fields(row_template: &str) -> (String, Vec<MarkdownField>) {
    let mut prefix = String::from("DASHQLMARKDOWNFIELD");
    while row_template.contains(&prefix) {
        prefix.push('X');
    }

    let mut markdown = String::with_capacity(row_template.len());
    let mut fields: Vec<MarkdownField> = Vec::new();
    let mut text_begin = 0;
    for placeholder in markdown_placeholders(row_template) {
        markdown.push_str(row_template.get(text_begin..placeholder.range.start).unwrap_or_default());
        match fields.iter().find(|field| field.name == placeholder.name) {
            Some(field) => markdown.push_str(&field.token),
            None => {
                let token = format!("{prefix}{}TOKEN", fields.len());
                markdown.push_str(&token);
                fields.push(MarkdownField { name: placeholder.name.to_string(), token });
            }
        }
        text_begin = placeholder.range.end;
    }
    markdown.push_str(row_template.get(text_begin..).unwrap_or_default());
    (markdown, fields)
}

/// Relative URLs and the schemes http, https and mailto are safe
fn is_safe_url(url: &str) -> bool {
    let normalized: String = url.chars().filter(|&c| c > ' ' && c != '\x7f').map(|c| c.to_ascii_lowercase()).collect();
    let Some((scheme, _)) = normalized.split_once(':') else {
        return true;
    };
    if normalized.find(['/', '?', '#']).is_some_and(|delimiter| delimiter < scheme.len()) {
        return true;
    }
    matches!(scheme, "http" | "https" | "mailto")
}

/// Builds the document tree from the pulldown-cmark events
struct DocumentBuilder<'a> {
    /// The fields of the template
    fields: &'a [MarkdownField],
    /// The open nodes, the root first. A node is added to its parent when it is closed.
    stack: Vec<MarkdownNode>,
    /// Text that is not yet added, so that adjacent text events become one node
    text: String,
    /// Inside a raw HTML block, which is dropped
    in_html_block: bool,
}

impl<'a> DocumentBuilder<'a> {
    fn new(fields: &'a [MarkdownField]) -> Self {
        Self {
            fields,
            stack: vec![MarkdownNode::new(MarkdownNodeType::DOCUMENT)],
            text: String::new(),
            in_html_block: false,
        }
    }

    fn finish(mut self) -> MarkdownNode {
        self.flush_text();
        while self.stack.len() > 1 {
            self.close();
        }
        // The root stays on the stack until here
        self.stack.pop().unwrap_or_else(|| MarkdownNode::new(MarkdownNodeType::DOCUMENT))
    }

    fn contains_field(&self, text: &str) -> bool {
        self.fields.iter().any(|field| text.contains(&field.token))
    }

    fn append(&mut self, node: MarkdownNode) {
        if let Some(parent) = self.stack.last_mut() {
            parent.children.push(node);
        }
    }

    fn open(&mut self, node: MarkdownNode) {
        self.flush_text();
        self.stack.push(node);
    }

    fn close(&mut self) {
        self.flush_text();
        if self.stack.len() <= 1 {
            return;
        }
        if let Some(mut node) = self.stack.pop() {
            if node.node_type == MarkdownNodeType::LIST {
                // pulldown-cmark does not report the tightness of a list, but it omits the paragraphs of tight items
                node.tight = !node
                    .children
                    .iter()
                    .any(|item| item.children.iter().any(|child| child.node_type == MarkdownNodeType::PARAGRAPH));
            }
            self.append(node);
        }
    }

    /// Add the pending text, with field tokens replaced by field nodes
    fn flush_text(&mut self) {
        if !self.text.is_empty() {
            let text = std::mem::take(&mut self.text);
            self.append_text(&text);
        }
    }

    fn append_text(&mut self, text: &str) {
        let mut rest = text;
        while !rest.is_empty() {
            let next_field = self
                .fields
                .iter()
                .filter_map(|field| rest.find(&field.token).map(|at| (at, field)))
                .min_by_key(|(at, _)| *at);
            let Some((at, field)) = next_field else {
                self.append(MarkdownNode::leaf(MarkdownNodeType::TEXT, rest));
                break;
            };
            let (before, from_field) = rest.split_at_checked(at).unwrap_or((rest, ""));
            if !before.is_empty() {
                self.append(MarkdownNode::leaf(MarkdownNodeType::TEXT, before));
            }
            self.append(MarkdownNode::leaf(MarkdownNodeType::FIELD, &field.name));
            rest = from_field.get(field.token.len()..).unwrap_or("");
        }
    }

    /// A link or an image, a span without URL and title if the URL is unsafe or contains a field
    fn link(&self, node_type: MarkdownNodeType, link_type: LinkType, url: &str, title: &str) -> MarkdownNode {
        let url = if link_type == LinkType::Email { format!("mailto:{url}") } else { url.to_string() };
        if !is_safe_url(&url) || self.contains_field(&url) {
            return MarkdownNode::new(MarkdownNodeType::SPAN);
        }
        let mut node = MarkdownNode::new(node_type);
        if !self.contains_field(title) {
            node.title = title.to_string();
        }
        node.url = url;
        node
    }

    /// The language of a fenced code block, the first word of its info string, empty if it contains a field
    fn code_language(&self, info: &str) -> String {
        let language = info.split_whitespace().next().unwrap_or_default();
        if self.contains_field(language) {
            String::new()
        } else {
            language.to_string()
        }
    }

    fn start(&mut self, tag: Tag) {
        let node = match tag {
            Tag::Paragraph => MarkdownNode::new(MarkdownNodeType::PARAGRAPH),
            Tag::Heading { level, .. } => {
                MarkdownNode { level: level as u8, ..MarkdownNode::new(MarkdownNodeType::HEADING) }
            }
            Tag::BlockQuote(_) => MarkdownNode::new(MarkdownNodeType::BLOCKQUOTE),
            Tag::CodeBlock(kind) => {
                let language = match kind {
                    CodeBlockKind::Fenced(info) => self.code_language(&info),
                    CodeBlockKind::Indented => String::new(),
                };
                MarkdownNode { language, ..MarkdownNode::new(MarkdownNodeType::CODE_BLOCK) }
            }
            Tag::List(start) => MarkdownNode {
                ordered: start.is_some(),
                start: start.map_or(0, |start| u32::try_from(start).unwrap_or(u32::MAX)),
                ..MarkdownNode::new(MarkdownNodeType::LIST)
            },
            Tag::Item => MarkdownNode::new(MarkdownNodeType::LIST_ITEM),
            Tag::Emphasis => MarkdownNode::new(MarkdownNodeType::EMPHASIS),
            Tag::Strong => MarkdownNode::new(MarkdownNodeType::STRONG),
            Tag::Link { link_type, dest_url, title, .. } => {
                self.link(MarkdownNodeType::LINK, link_type, &dest_url, &title)
            }
            Tag::Image { link_type, dest_url, title, .. } => {
                self.link(MarkdownNodeType::IMAGE, link_type, &dest_url, &title)
            }
            Tag::HtmlBlock => {
                self.in_html_block = true;
                return;
            }
            // The extensions are not enabled
            _ => MarkdownNode::new(MarkdownNodeType::SPAN),
        };
        self.open(node);
    }

    fn event(&mut self, event: Event) {
        if self.in_html_block {
            self.in_html_block = event != Event::End(TagEnd::HtmlBlock);
            return;
        }
        match event {
            Event::Start(tag) => self.start(tag),
            Event::End(_) => self.close(),
            Event::Text(text) => self.text.push_str(&text),
            Event::SoftBreak => self.text.push('\n'),
            Event::Code(code) => {
                self.open(MarkdownNode::new(MarkdownNodeType::INLINE_CODE));
                self.append_text(&code);
                self.close();
            }
            Event::HardBreak => {
                self.flush_text();
                self.append(MarkdownNode::new(MarkdownNodeType::HARD_BREAK));
            }
            Event::Rule => {
                self.flush_text();
                self.append(MarkdownNode::new(MarkdownNodeType::THEMATIC_BREAK));
            }
            // Inline HTML is dropped, the other events belong to extensions that are not enabled
            _ => {}
        }
    }
}

/// Compile a Markdown row template into a document
pub fn compile_markdown_template(row_template: &str) -> MarkdownDocument {
    let (markdown, fields) = tokenize_fields(row_template);
    // CommonMark replaces NUL characters for security reasons, pulldown-cmark leaves that to the caller
    let markdown = markdown.replace('\0', "\u{fffd}");
    let mut builder = DocumentBuilder::new(&fields);
    for event in Parser::new(&markdown) {
        builder.event(event);
    }
    let document = builder.finish();
    MarkdownDocument {
        template: row_template.to_string(),
        fields: fields.into_iter().map(|field| field.name).collect(),
        document,
    }
}

/// Compile a Markdown text without fields into a document, e.g. the answer of an agent: `{{name}}` stays text
pub fn compile_markdown_text(text: &str) -> MarkdownDocument {
    let markdown = text.replace('\0', "\u{fffd}");
    let mut builder = DocumentBuilder::new(&[]);
    for event in Parser::new(&markdown) {
        builder.event(event);
    }
    MarkdownDocument { template: String::new(), fields: Vec::new(), document: builder.finish() }
}

/// Compile the Markdown spec of a visualization, `None` if it has none
pub fn compile_markdown_spec(spec: &VisualizationSpec) -> Option<MarkdownDocument> {
    Some(compile_markdown_template(&spec.markdown.as_ref()?.row_template))
}

/// A string of a FlatBuffer object, empty strings are not set
fn non_empty(s: &str) -> Option<String> {
    (!s.is_empty()).then(|| s.to_string())
}

impl MarkdownNode {
    /// The FlatBuffer object of a node, empty strings and vectors are not set
    pub fn to_object(&self) -> MarkdownNodeT {
        let mut node = MarkdownNodeT::default();
        node.node_type = self.node_type;
        node.value = non_empty(&self.value);
        node.url = non_empty(&self.url);
        node.title = non_empty(&self.title);
        node.language = non_empty(&self.language);
        node.level = self.level;
        node.start = self.start;
        node.ordered = self.ordered;
        node.tight = self.tight;
        node.children =
            (!self.children.is_empty()).then(|| self.children.iter().map(MarkdownNode::to_object).collect());
        node
    }
}

impl MarkdownDocument {
    /// The FlatBuffer object of a compiled document, empty strings and vectors are not set
    pub fn to_object(&self) -> MarkdownSpecT {
        let mut spec = MarkdownSpecT::default();
        spec.template = non_empty(&self.template);
        spec.fields = (!self.fields.is_empty()).then(|| self.fields.clone());
        spec.document = Some(Box::new(self.document.to_object()));
        spec
    }
}

#[cfg(test)]
mod tests;
