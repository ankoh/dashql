//! A small document arena for width-aware SQL layout.
//!
//! The formatter builds a program of formatting operations (text, breaks, concatenations, joins,
//! indentation and parentheses) and renders it with a width-aware stack machine. Joins are rendered
//! inline if they fit, otherwise broken according to their join policy.

use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode, KeywordCase};
use dashql_parser::keywords::Keyword;
use std::cell::RefCell;

pub const FORMATTING_DEFAULT_INDENTATION_WIDTH: usize = 2;
pub const FORMATTING_DEFAULT_MAX_WIDTH: usize = 120;

/// The name of a formatting mode
pub fn formatting_mode_to_string(mode: FormattingMode) -> &'static str {
    match mode {
        FormattingMode::INLINE => "inline",
        FormattingMode::COMPACT => "compact",
        FormattingMode::PRETTY => "pretty",
        _ => "compact",
    }
}

/// The name of a formatting dialect
pub fn formatting_dialect_to_string(dialect: FormattingDialect) -> &'static str {
    match dialect {
        FormattingDialect::HYPER => "hyper",
        FormattingDialect::TRINO => "trino",
        _ => "hyper",
    }
}

/// A register of the formatting program, 0 is the empty document
pub type FmtReg = u32;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FormattingOpCode {
    #[default]
    Empty,
    Text,
    Break,
    Concat,
    Join,
    Indent,
    Parenthesis,
    Brackets,
    /// A comment at the end of the line: it is written before the next line break, and the text after it starts a new
    /// line
    LineSuffix,
    /// A line break unless the line holds nothing but indentation
    LineStart,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FormattingJoinPolicy {
    /// Render inline only if the entire join can be rendered without breaks.
    #[default]
    BreakAllOrNone,
    /// Render progressively: keep each separator inline while the next segment fits.
    BreakOnOverflow,
    /// Always render this join broken unless global INLINE mode forces flat output.
    ForceBreak,
}

/// An operation of a formatting program, a node of the document tree
#[derive(Clone, Debug, Default)]
pub struct FormattingOperation<'a> {
    /// The operation kind
    pub code: FormattingOpCode,
    /// The text of a text operation
    pub text: &'a str,
    /// Verbatim text keeps its case when keywords are upper-cased
    pub verbatim: bool,
    /// The child documents of a concat, join, indent, parenthesis or brackets operation
    pub children: Vec<FmtReg>,
    /// The separator between join children when rendered inline
    pub inline_separator: FmtReg,
    /// The separator between join children when rendered broken
    pub break_separator: FmtReg,
    /// Indent the join children when the join is rendered broken?
    pub indent_after_breaks: bool,
    /// The policy that decides where a join breaks
    pub join_policy: FormattingJoinPolicy,
    /// Parentheses or brackets that break also break an all-or-none join inside, with one item per line
    pub break_list: bool,
    /// Is the join a list of items, like the arguments of a call? A list in parentheses that break starts its line, so
    /// the items after its breaks line up with its first one, without the hanging indentation.
    pub list: bool,
    /// The offset of the comment of a line suffix in the script
    pub comment_offset: u32,
}

/// The options for rendering a formatting program
#[derive(Clone, Copy, Debug)]
pub struct FormattingRenderOptions {
    /// The maximum line width in characters
    pub max_width: usize,
    /// The number of spaces per indentation level
    pub indentation_width: usize,
    /// Append the line width as `/*n*/` comment before every line break?
    pub debug_mode: bool,
    /// The formatting mode, INLINE renders every join and parenthesis flat
    pub mode: FormattingMode,
    /// The case of keywords in generated text
    pub keyword_case: KeywordCase,
}

impl Default for FormattingRenderOptions {
    fn default() -> Self {
        Self {
            max_width: FORMATTING_DEFAULT_MAX_WIDTH,
            indentation_width: FORMATTING_DEFAULT_INDENTATION_WIDTH,
            debug_mode: false,
            mode: FormattingMode::COMPACT,
            keyword_case: KeywordCase::LOWER,
        }
    }
}

/// A small document arena for width-aware SQL layout.
///
/// The builder methods take `&self` (the arena lives in a `RefCell`), so that operations can be
/// nested: `f.concat(&[f.text("a"), f.text("b")])`.
pub struct FormattingProgram<'a> {
    /// The formatting config, selects the default join policy
    pub config: FormattingConfigT,
    /// The operations, register 0 is the empty document
    program: RefCell<Vec<FormattingOperation<'a>>>,
}

impl Default for FormattingProgram<'_> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'a> FormattingProgram<'a> {
    pub fn new() -> Self {
        let mut config = FormattingConfigT::default();
        config.mode = FormattingMode::COMPACT;
        let program = Self { config, program: RefCell::new(Vec::new()) };
        program.reset();
        program
    }

    pub fn set_config(&mut self, value: &FormattingConfigT) {
        self.config = value.clone();
    }

    pub fn reset(&self) {
        let mut program = self.program.borrow_mut();
        program.clear();
        program.push(FormattingOperation::default());
    }

    pub fn empty(&self) -> FmtReg {
        0
    }

    pub fn text(&self, text: &'a str) -> FmtReg {
        self.push(FormattingOperation { code: FormattingOpCode::Text, text, ..Default::default() })
    }

    pub fn verbatim(&self, text: &'a str) -> FmtReg {
        self.push(FormattingOperation { code: FormattingOpCode::Text, text, verbatim: true, ..Default::default() })
    }

    pub fn break_(&self) -> FmtReg {
        self.push(FormattingOperation { code: FormattingOpCode::Break, ..Default::default() })
    }

    /// A comment at the end of the line, its text and its offset in the script, see `FormattingOpCode::LineSuffix`
    pub fn line_suffix(&self, text: &'a str, comment_offset: u32) -> FmtReg {
        self.push(FormattingOperation {
            code: FormattingOpCode::LineSuffix,
            text,
            verbatim: true,
            comment_offset,
            ..Default::default()
        })
    }

    /// A line break unless the line is empty
    pub fn line_start(&self) -> FmtReg {
        self.push(FormattingOperation { code: FormattingOpCode::LineStart, ..Default::default() })
    }

    /// Concatenate documents, skipping empty ones
    pub fn concat(&self, parts: &[FmtReg]) -> FmtReg {
        let parts: Vec<FmtReg> = parts.iter().copied().filter(|&p| p != 0).collect();
        match parts.as_slice() {
            [] => return self.empty(),
            &[part] => return part,
            _ => {}
        }
        self.push(FormattingOperation { code: FormattingOpCode::Concat, children: parts, ..Default::default() })
    }

    pub fn indented(&self, child: FmtReg) -> FmtReg {
        if child == 0 {
            return self.empty();
        }
        self.push(FormattingOperation { code: FormattingOpCode::Indent, children: vec![child], ..Default::default() })
    }

    pub fn parenthesized(&self, child: FmtReg) -> FmtReg {
        if child == 0 {
            return self.empty();
        }
        self.push(FormattingOperation {
            code: FormattingOpCode::Parenthesis,
            children: vec![child],
            ..Default::default()
        })
    }

    pub fn bracketed(&self, child: FmtReg) -> FmtReg {
        if child == 0 {
            return self.empty();
        }
        self.push(FormattingOperation { code: FormattingOpCode::Brackets, children: vec![child], ..Default::default() })
    }

    /// A list in parentheses that has one item per line if the parentheses break
    pub fn parenthesized_list(&self, list: FmtReg) -> FmtReg {
        if list == 0 {
            return self.empty();
        }
        self.push(FormattingOperation {
            code: FormattingOpCode::Parenthesis,
            children: vec![list],
            break_list: true,
            ..Default::default()
        })
    }

    /// A list in brackets that has one item per line if the brackets break
    pub fn bracketed_list(&self, list: FmtReg) -> FmtReg {
        if list == 0 {
            return self.empty();
        }
        self.push(FormattingOperation {
            code: FormattingOpCode::Brackets,
            children: vec![list],
            break_list: true,
            ..Default::default()
        })
    }

    /// Join documents with separators, skipping empty ones.
    ///
    /// Without a policy, joins break all or none in pretty mode and on overflow otherwise.
    pub fn join(
        &self,
        items: &[FmtReg],
        inline_separator: FmtReg,
        break_separator: FmtReg,
        join_policy: Option<FormattingJoinPolicy>,
        indent_after_breaks: bool,
    ) -> FmtReg {
        self.new_join(items, inline_separator, break_separator, join_policy, indent_after_breaks, false)
    }

    /// Join the items of a list, see `FormattingOperation::list`
    pub fn list(
        &self,
        items: &[FmtReg],
        inline_separator: FmtReg,
        break_separator: FmtReg,
        join_policy: Option<FormattingJoinPolicy>,
        indent_after_breaks: bool,
    ) -> FmtReg {
        self.new_join(items, inline_separator, break_separator, join_policy, indent_after_breaks, true)
    }

    fn new_join(
        &self,
        items: &[FmtReg],
        inline_separator: FmtReg,
        break_separator: FmtReg,
        join_policy: Option<FormattingJoinPolicy>,
        indent_after_breaks: bool,
        list: bool,
    ) -> FmtReg {
        let filtered: Vec<FmtReg> = items.iter().copied().filter(|&i| i != 0).collect();
        match filtered.as_slice() {
            [] => return self.empty(),
            &[item] => return item,
            _ => {}
        }
        let selected_policy = join_policy.unwrap_or(if self.config.mode == FormattingMode::PRETTY {
            FormattingJoinPolicy::BreakAllOrNone
        } else {
            FormattingJoinPolicy::BreakOnOverflow
        });
        self.push(FormattingOperation {
            code: FormattingOpCode::Join,
            children: filtered,
            inline_separator,
            break_separator,
            indent_after_breaks,
            join_policy: selected_policy,
            list,
            ..Default::default()
        })
    }

    /// How often a document is referenced from `root` and the documents that it reaches, indexed by register.
    /// The separators of a join count once.
    pub fn reference_counts(&self, root: FmtReg) -> Vec<u32> {
        let program = self.program.borrow();
        let mut counts = vec![0u32; program.len()];
        let mut pending = vec![root];
        while let Some(reg) = pending.pop() {
            let Some(count) = counts.get_mut(reg as usize) else { continue };
            *count += 1;
            if *count > 1 {
                continue;
            }
            // A register outside of the program is the empty document
            let Some(doc) = program.get(reg as usize) else { continue };
            pending.extend(doc.children.iter().copied());
            pending.extend([doc.inline_separator, doc.break_separator].into_iter().filter(|&s| s != 0));
        }
        counts
    }

    /// Does the document `outer` start with the document `inner`, with nothing rendered before it?
    pub fn starts_with(&self, outer: FmtReg, inner: FmtReg) -> bool {
        self.is_at_edge(outer, inner, |children| children.first())
    }

    /// Does the document `outer` end with the document `inner`, with nothing rendered after it?
    pub fn ends_with(&self, outer: FmtReg, inner: FmtReg) -> bool {
        self.is_at_edge(outer, inner, |children| children.last())
    }

    /// Is `inner` reached from `outer` through the edge children of concatenations, joins and indentations?
    fn is_at_edge(&self, outer: FmtReg, inner: FmtReg, edge: impl Fn(&[FmtReg]) -> Option<&FmtReg>) -> bool {
        let program = self.program.borrow();
        let mut reg = outer;
        loop {
            if reg == inner {
                return true;
            }
            let Some(doc) = program.get(reg as usize) else { return false };
            match doc.code {
                FormattingOpCode::Concat | FormattingOpCode::Join | FormattingOpCode::Indent => {
                    match edge(&doc.children) {
                        Some(&child) => reg = child,
                        None => return false,
                    }
                }
                _ => return false,
            }
        }
    }

    /// Take the items of a join, which leaves it empty: a join around it continues them, like the operands of a chain
    pub fn take_join_items(&self, reg: FmtReg) -> Option<Vec<FmtReg>> {
        let mut program = self.program.borrow_mut();
        let doc = program.get_mut(reg as usize).filter(|doc| reg != 0 && doc.code == FormattingOpCode::Join)?;
        Some(std::mem::take(doc).children)
    }

    /// Put documents around a document, every reference to `reg` then renders them too
    pub fn wrap(&self, reg: FmtReg, prefix: &[FmtReg], suffix: &[FmtReg]) {
        if reg == 0 || (prefix.is_empty() && suffix.is_empty()) {
            return;
        }
        let mut program = self.program.borrow_mut();
        let Some(doc) = program.get_mut(reg as usize) else { return };
        let moved = std::mem::take(doc);
        program.push(moved);
        let moved_reg = (program.len() - 1) as FmtReg;
        let children = prefix.iter().chain(std::iter::once(&moved_reg)).chain(suffix).copied().collect();
        if let Some(doc) = program.get_mut(reg as usize) {
            *doc = FormattingOperation { code: FormattingOpCode::Concat, children, ..Default::default() };
        }
    }

    fn push(&self, doc: FormattingOperation<'a>) -> FmtReg {
        let mut program = self.program.borrow_mut();
        program.push(doc);
        (program.len() - 1) as FmtReg
    }

    /// Render a document, a line suffix that no line break followed ends it
    pub fn render(&self, root: FmtReg, options: &FormattingRenderOptions) -> String {
        let program = self.program.borrow();
        let (mut output, suffix) = render(&program, root, options);
        if let Some((suffix, _)) = suffix {
            output.push(' ');
            output.push_str(suffix);
        }
        output
    }

    /// Render a document without the line suffix that no line break followed, and return the offset of its comment
    pub fn render_with_suffix(&self, root: FmtReg, options: &FormattingRenderOptions) -> (String, Option<u32>) {
        let program = self.program.borrow();
        let (output, suffix) = render(&program, root, options);
        (output, suffix.map(|(_, offset)| offset))
    }
}

const FORMATTING_INLINE_WIDTH_SAFETY_BUFFER: isize = 2;

fn remaining_inline_width(max_width: usize, current_line_width: usize) -> isize {
    let remaining = max_width as isize - current_line_width as isize;
    remaining - FORMATTING_INLINE_WIDTH_SAFETY_BUFFER
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RendererOpCode {
    Format,
    JoinNextBreakOnOverflow,
    /// Close a parenthesis or brackets on the same line
    Close(char),
    /// Close a parenthesis or brackets on a new line
    CloseAfterBreak(char),
}

/// A pending document of an inline dry run
#[derive(Clone, Copy, Debug)]
struct InlineRenderCommand {
    /// The document to measure
    doc: FmtReg,
    /// The indentation of the document
    indentation: usize,
}

/// A pending step of the renderer
#[derive(Clone, Copy, Debug)]
struct RenderCommand {
    /// The step kind
    kind: RendererOpCode,
    /// The document to render, or the join that continues
    reg: FmtReg,
    /// The indentation of the document
    indentation: usize,
    /// The index of the next join child to render on overflow
    next_index: usize,
}

impl RenderCommand {
    fn format(reg: FmtReg, indentation: usize) -> Self {
        Self { kind: RendererOpCode::Format, reg, indentation, next_index: 0 }
    }
}

/// The child of an indent, parentheses or brackets, None if it has none
fn get_only_child(doc: &FormattingOperation) -> Option<FmtReg> {
    debug_assert!(doc.children.len() <= 1);
    doc.children.first().copied()
}

fn push_inline_children(stack: &mut Vec<InlineRenderCommand>, children: &[FmtReg], indentation: usize) {
    for &child in children.iter().rev() {
        stack.push(InlineRenderCommand { doc: child, indentation });
    }
}

fn push_docs(stack: &mut Vec<RenderCommand>, children: &[FmtReg], indentation: usize) {
    for &child in children.iter().rev() {
        stack.push(RenderCommand::format(child, indentation));
    }
}

fn push_inline_join(stack: &mut Vec<InlineRenderCommand>, doc: &FormattingOperation, indentation: usize) {
    for (i, &child) in doc.children.iter().enumerate().rev() {
        stack.push(InlineRenderCommand { doc: child, indentation });
        if i > 0 && doc.inline_separator != 0 {
            stack.push(InlineRenderCommand { doc: doc.inline_separator, indentation });
        }
    }
}

fn push_rendered_join(
    stack: &mut Vec<RenderCommand>,
    doc: &FormattingOperation,
    indentation: usize,
    separator: FmtReg,
) {
    for (i, &child) in doc.children.iter().enumerate().rev() {
        stack.push(RenderCommand::format(child, indentation));
        if i > 0 && separator != 0 {
            stack.push(RenderCommand::format(separator, indentation));
        }
    }
}

/// The width of a text in characters, `'äöü'` is 5 wide
fn text_width(text: &str) -> usize {
    text.chars().count()
}

/// The width of the text that a document starts with, up to its first possible line break.
/// Returns the width and whether a line break could follow.
fn leading_inline_width(reg: FmtReg, program: &[FormattingOperation]) -> (usize, bool) {
    // A register outside of the program is the empty document
    let Some(doc) = program.get(reg as usize) else { return (0, false) };
    match doc.code {
        FormattingOpCode::Empty => (0, false),
        FormattingOpCode::Text => (text_width(doc.text), false),
        FormattingOpCode::Break | FormattingOpCode::LineStart => (0, true),
        FormattingOpCode::LineSuffix => (0, false),
        FormattingOpCode::Concat => {
            let mut width = 0;
            for &child in doc.children.iter() {
                let (child_width, breaks) = leading_inline_width(child, program);
                width += child_width;
                if breaks {
                    return (width, true);
                }
            }
            (width, false)
        }
        FormattingOpCode::Indent => {
            doc.children.first().map_or((0, false), |&child| leading_inline_width(child, program))
        }
        // A join may break after its first item, parentheses after the opening one
        FormattingOpCode::Join => match doc.children.first() {
            Some(&first) => {
                let (width, breaks) = leading_inline_width(first, program);
                (width, breaks || doc.children.len() > 1)
            }
            None => (0, false),
        },
        FormattingOpCode::Parenthesis | FormattingOpCode::Brackets => (1, true),
    }
}

/// The width of the text that follows on the current line, up to the first possible line break of the pending steps.
/// A document fits inline only if this text fits behind it, e.g. the alias after a parenthesized window.
fn trailing_inline_width(stack: &[RenderCommand], program: &[FormattingOperation]) -> usize {
    let mut width = 0;
    for command in stack.iter().rev() {
        let (command_width, breaks) = match command.kind {
            RendererOpCode::Format => leading_inline_width(command.reg, program),
            RendererOpCode::Close(_) => (1, false),
            RendererOpCode::CloseAfterBreak(_) => (0, true),
            // The next item of a join follows its separator, which may break. The safety buffer of the remaining
            // width covers a separator that stays on the line.
            RendererOpCode::JoinNextBreakOnOverflow => {
                (0, program.get(command.reg as usize).is_some_and(|doc| command.next_index < doc.children.len()))
            }
        };
        width += command_width;
        if breaks {
            break;
        }
    }
    width
}

/// Does the stack render inline within the remaining width?
fn dry_run_inline(
    mut remaining: isize,
    mut stack: Vec<InlineRenderCommand>,
    program: &[FormattingOperation],
    options: &FormattingRenderOptions,
) -> bool {
    while remaining >= 0 {
        let Some(command) = stack.pop() else { break };
        // A register outside of the program is the empty document
        let Some(doc) = program.get(command.doc as usize) else { continue };
        match doc.code {
            FormattingOpCode::Empty => {}
            FormattingOpCode::Text => remaining -= text_width(doc.text) as isize,
            // A line suffix needs a line break after it
            FormattingOpCode::Break | FormattingOpCode::LineStart | FormattingOpCode::LineSuffix => return false,
            FormattingOpCode::Concat => push_inline_children(&mut stack, &doc.children, command.indentation),
            FormattingOpCode::Join => {
                if doc.join_policy == FormattingJoinPolicy::ForceBreak && doc.children.len() > 1 {
                    return false;
                }
                push_inline_join(&mut stack, doc, command.indentation);
            }
            FormattingOpCode::Indent => {
                if let Some(child) = get_only_child(doc) {
                    stack.push(InlineRenderCommand {
                        doc: child,
                        indentation: command.indentation + options.indentation_width,
                    });
                }
            }
            FormattingOpCode::Parenthesis | FormattingOpCode::Brackets => {
                remaining -= 2;
                if let Some(child) = get_only_child(doc) {
                    stack.push(InlineRenderCommand { doc: child, indentation: command.indentation });
                }
            }
        }
    }
    remaining >= 0
}

fn join_fits_inline(
    remaining: isize,
    doc: &FormattingOperation,
    indentation: usize,
    program: &[FormattingOperation],
    options: &FormattingRenderOptions,
) -> bool {
    let mut stack = Vec::new();
    push_inline_join(&mut stack, doc, indentation);
    dry_run_inline(remaining, stack, program, options)
}

fn can_inline_join_step(
    remaining: isize,
    doc: &FormattingOperation,
    next_index: usize,
    indentation: usize,
    program: &[FormattingOperation],
    options: &FormattingRenderOptions,
) -> bool {
    let Some(&child) = doc.children.get(next_index) else { return true };
    let mut stack = vec![InlineRenderCommand { doc: child, indentation }];
    if doc.inline_separator != 0 {
        stack.push(InlineRenderCommand { doc: doc.inline_separator, indentation });
    }
    dry_run_inline(remaining, stack, program, options)
}

fn parenthesis_fits_inline(
    remaining: isize,
    doc: &FormattingOperation,
    indentation: usize,
    program: &[FormattingOperation],
    options: &FormattingRenderOptions,
) -> bool {
    if remaining < 2 {
        return false;
    }
    let mut stack = Vec::new();
    if let Some(child) = get_only_child(doc) {
        stack.push(InlineRenderCommand { doc: child, indentation });
    }
    dry_run_inline(remaining - 2, stack, program, options)
}

/// The state of a rendered line
struct Line<'a> {
    /// The width of the line in characters
    width: usize,
    /// The comment that ends the line, written before the next line break, and its offset in the script
    suffix: Option<(&'a str, u32)>,
}

fn append_line_break(output: &mut String, line: &mut Line, indentation: usize, debug_mode: bool) {
    if debug_mode {
        output.push_str(" /*");
        output.push_str(&line.width.to_string());
        output.push_str("*/");
    }
    if let Some((suffix, _)) = line.suffix.take() {
        output.push(' ');
        output.push_str(suffix);
    }
    output.push('\n');
    output.extend(std::iter::repeat_n(' ', indentation));
    line.width = indentation;
}

/// Append generated text, upper-casing the words that are keywords
fn append_generated_text(output: &mut String, text: &str) {
    let is_word = |ch: u8| ch.is_ascii_alphanumeric() || ch == b'_';
    let mut rest = text;
    while let Some(first) = rest.bytes().next() {
        // Words are ASCII, so runs of other bytes end at char boundaries
        let in_word = is_word(first);
        let end = rest.bytes().position(|ch| is_word(ch) != in_word).unwrap_or(rest.len());
        let (run, tail) = rest.split_at_checked(end).unwrap_or((rest, ""));
        if in_word && Keyword::find(run.as_bytes()).is_some() {
            output.push_str(&run.to_ascii_uppercase());
        } else {
            output.push_str(run);
        }
        rest = tail;
    }
}

/// A join to render
#[derive(Clone, Copy, Debug)]
struct JoinRendering {
    /// The join document
    reg: FmtReg,
    /// The indentation of the join
    indentation: usize,
    /// Indent the lines after the breaks if the join wants it? Not for a list that starts its line.
    hanging: bool,
}

/// Push the steps that render a join: inline if it fits, otherwise broken by its policy
fn push_join(
    stack: &mut Vec<RenderCommand>,
    doc: &FormattingOperation,
    join: JoinRendering,
    line_width: usize,
    force_inline: bool,
    program: &[FormattingOperation],
    options: &FormattingRenderOptions,
) {
    if force_inline
        || (doc.join_policy != FormattingJoinPolicy::ForceBreak
            && join_fits_inline(
                remaining_inline_width(options.max_width, line_width) - trailing_inline_width(stack, program) as isize,
                doc,
                join.indentation,
                program,
                options,
            ))
    {
        push_rendered_join(stack, doc, join.indentation, doc.inline_separator);
        return;
    }
    let hanging = join.hanging && doc.indent_after_breaks;
    let indent = join.indentation + if hanging { options.indentation_width } else { 0 };
    match doc.join_policy {
        FormattingJoinPolicy::BreakAllOrNone | FormattingJoinPolicy::ForceBreak => {
            push_rendered_join(stack, doc, indent, doc.break_separator);
        }
        FormattingJoinPolicy::BreakOnOverflow => {
            if let Some(&first) = doc.children.first() {
                if doc.children.len() > 1 {
                    stack.push(RenderCommand {
                        kind: RendererOpCode::JoinNextBreakOnOverflow,
                        reg: join.reg,
                        indentation: indent,
                        next_index: 1,
                    });
                }
                stack.push(RenderCommand::format(first, indent));
            }
        }
    }
}

fn render<'a>(
    program: &[FormattingOperation<'a>],
    root: FmtReg,
    options: &FormattingRenderOptions,
) -> (String, Option<(&'a str, u32)>) {
    let mut output = String::new();
    let mut line = Line { width: 0, suffix: None };
    let force_inline = options.mode == FormattingMode::INLINE;

    let mut stack = vec![RenderCommand::format(root, 0)];
    while let Some(command) = stack.pop() {
        match command.kind {
            RendererOpCode::Close(close) => {
                if line.suffix.is_some() {
                    append_line_break(&mut output, &mut line, command.indentation, options.debug_mode);
                }
                output.push(close);
                line.width += 1;
                continue;
            }
            RendererOpCode::CloseAfterBreak(close) => {
                append_line_break(&mut output, &mut line, command.indentation, options.debug_mode);
                output.push(close);
                line.width += 1;
                continue;
            }
            RendererOpCode::JoinNextBreakOnOverflow => {
                let Some(doc) = program.get(command.reg as usize) else { continue };
                let Some(&child) = doc.children.get(command.next_index) else { continue };
                let next = RenderCommand {
                    kind: RendererOpCode::JoinNextBreakOnOverflow,
                    reg: command.reg,
                    indentation: command.indentation,
                    next_index: command.next_index + 1,
                };
                // The last item is followed by the text after the join
                let trailing = if command.next_index + 1 >= doc.children.len() {
                    trailing_inline_width(&stack, program)
                } else {
                    0
                };
                // A line suffix ends the line before the next item
                if line.suffix.is_none()
                    && can_inline_join_step(
                        remaining_inline_width(options.max_width, line.width) - trailing as isize,
                        doc,
                        command.next_index,
                        command.indentation,
                        program,
                        options,
                    )
                {
                    stack.push(next);
                    stack.push(RenderCommand::format(child, command.indentation));
                    if doc.inline_separator != 0 {
                        stack.push(RenderCommand::format(doc.inline_separator, command.indentation));
                    }
                } else {
                    let next_is_parenthesis =
                        program.get(child as usize).is_some_and(|c| c.code == FormattingOpCode::Parenthesis);
                    let use_inline_separator =
                        line.suffix.is_none() && next_is_parenthesis && doc.inline_separator != 0;
                    stack.push(next);
                    stack.push(RenderCommand::format(child, command.indentation));
                    if doc.break_separator != 0 {
                        let separator = if use_inline_separator { doc.inline_separator } else { doc.break_separator };
                        stack.push(RenderCommand::format(separator, command.indentation));
                    }
                }
                continue;
            }
            RendererOpCode::Format => {}
        }

        // A register outside of the program is the empty document
        let Some(doc) = program.get(command.reg as usize) else { continue };
        match doc.code {
            FormattingOpCode::Empty => {}
            FormattingOpCode::Text => {
                let mut text = doc.text;
                // Text after a line suffix goes on the next line, a separator stays in front of the suffix
                if line.suffix.is_some() {
                    text = text.trim_start_matches(' ');
                    if let Some(rest) = text.strip_prefix(',') {
                        output.push(',');
                        line.width += 1;
                        text = rest.trim_start_matches(' ');
                    }
                    if text.is_empty() {
                        continue;
                    }
                    append_line_break(&mut output, &mut line, command.indentation, options.debug_mode);
                }
                if options.keyword_case == KeywordCase::UPPER && !doc.verbatim {
                    append_generated_text(&mut output, text);
                } else {
                    output.push_str(text);
                }
                line.width += text_width(text);
            }
            FormattingOpCode::Break => {
                append_line_break(&mut output, &mut line, command.indentation, options.debug_mode);
            }
            FormattingOpCode::LineSuffix => {
                // A second suffix ends the line of the first one
                if line.suffix.is_some() {
                    append_line_break(&mut output, &mut line, command.indentation, options.debug_mode);
                }
                line.suffix = Some((doc.text, doc.comment_offset));
            }
            FormattingOpCode::LineStart => {
                let line_text = output.rsplit('\n').next().unwrap_or_default();
                if !line_text.trim().is_empty() {
                    output.truncate(output.trim_end_matches(' ').len());
                    append_line_break(&mut output, &mut line, command.indentation, options.debug_mode);
                }
            }
            FormattingOpCode::Concat => push_docs(&mut stack, &doc.children, command.indentation),
            FormattingOpCode::Join => {
                let join = JoinRendering { reg: command.reg, indentation: command.indentation, hanging: true };
                push_join(&mut stack, doc, join, line.width, force_inline, program, options);
            }
            FormattingOpCode::Indent => {
                if let Some(child) = get_only_child(doc) {
                    stack.push(RenderCommand::format(child, command.indentation + options.indentation_width));
                }
            }
            FormattingOpCode::Parenthesis | FormattingOpCode::Brackets => {
                let (open, close) = if doc.code == FormattingOpCode::Brackets { ('[', ']') } else { ('(', ')') };
                let render_flat = force_inline
                    || parenthesis_fits_inline(
                        remaining_inline_width(options.max_width, line.width)
                            - trailing_inline_width(&stack, program) as isize,
                        doc,
                        command.indentation,
                        program,
                        options,
                    );
                output.push(open);
                line.width += 1;
                let close = if render_flat {
                    RendererOpCode::Close(close)
                } else {
                    append_line_break(
                        &mut output,
                        &mut line,
                        command.indentation + options.indentation_width,
                        options.debug_mode,
                    );
                    RendererOpCode::CloseAfterBreak(close)
                };
                stack.push(RenderCommand { kind: close, reg: 0, indentation: command.indentation, next_index: 0 });
                if let Some(child) = get_only_child(doc) {
                    let indentation = command.indentation + options.indentation_width;
                    // The content of parentheses that break starts its line, so the items of a list in them line up
                    let join =
                        program.get(child as usize).filter(|join| !render_flat && join.code == FormattingOpCode::Join);
                    match join {
                        Some(list) if doc.break_list && list.join_policy == FormattingJoinPolicy::BreakAllOrNone => {
                            push_rendered_join(&mut stack, list, indentation, list.break_separator);
                        }
                        Some(list) if list.list => {
                            let rendering = JoinRendering { reg: child, indentation, hanging: false };
                            push_join(&mut stack, list, rendering, line.width, force_inline, program, options);
                        }
                        _ => stack.push(RenderCommand::format(child, indentation)),
                    }
                }
            }
        }
    }
    (output, line.suffix)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(mode: FormattingMode, max_width: usize) -> FormattingRenderOptions {
        FormattingRenderOptions { mode, max_width, ..Default::default() }
    }

    fn comma_list<'a>(f: &FormattingProgram<'a>, items: &[&'a str], policy: Option<FormattingJoinPolicy>) -> FmtReg {
        let regs: Vec<FmtReg> = items.iter().map(|i| f.text(i)).collect();
        let break_separator = f.concat(&[f.text(","), f.break_()]);
        f.list(&regs, f.text(", "), break_separator, policy, true)
    }

    #[test]
    fn renders_line_suffixes_before_the_next_line_break() {
        let f = FormattingProgram::new();
        let opts = options(FormattingMode::COMPACT, 120);
        // A comma stays in front of the suffix, the text after it goes on the next line
        let doc = f.concat(&[f.text("a"), f.line_suffix("-- c", 7), f.text(", b")]);
        assert_eq!(f.render(doc, &opts), "a, -- c\nb");
        // A suffix that no line break follows is returned by its offset, two comments with the same text differ
        let doc = f.concat(&[f.text("a"), f.line_suffix("-- c", 7), f.text("b"), f.line_suffix("-- c", 15)]);
        assert_eq!(f.render_with_suffix(doc, &opts), ("a -- c\nb".to_string(), Some(15)));
        assert_eq!(f.render(doc, &opts), "a -- c\nb -- c");
    }

    #[test]
    fn concat_skips_empty_documents() {
        // Register 0 is the empty document
        const EMPTY: FmtReg = 0;
        let f = FormattingProgram::new();
        let a = f.text("a");
        assert_eq!(f.concat(&[]), EMPTY);
        assert_eq!(f.concat(&[EMPTY, a, EMPTY]), a);
        assert_eq!(f.indented(EMPTY), EMPTY);
        assert_eq!(f.parenthesized(EMPTY), EMPTY);
        assert_eq!(f.join(&[EMPTY, a], EMPTY, EMPTY, None, false), a);
        let both = f.concat(&[a, f.text("b")]);
        assert_eq!(f.render(both, &options(FormattingMode::COMPACT, 120)), "ab");
        assert_eq!(f.render(EMPTY, &options(FormattingMode::COMPACT, 120)), "");
    }

    #[test]
    fn join_breaks_all_or_none() {
        let f = FormattingProgram::new();
        let list = comma_list(&f, &["aaaa", "bbbb", "cccc"], Some(FormattingJoinPolicy::BreakAllOrNone));
        let root = f.concat(&[f.text("x "), list]);
        assert_eq!(f.render(root, &options(FormattingMode::COMPACT, 120)), "x aaaa, bbbb, cccc");
        // The safety buffer of 2 counts: 18 characters need a width of 20.
        assert_eq!(f.render(root, &options(FormattingMode::COMPACT, 20)), "x aaaa, bbbb, cccc");
        assert_eq!(f.render(root, &options(FormattingMode::COMPACT, 19)), "x aaaa,\n  bbbb,\n  cccc");
        assert_eq!(f.render(root, &options(FormattingMode::INLINE, 1)), "x aaaa, bbbb, cccc");
    }

    #[test]
    fn widths_count_characters() {
        let f = FormattingProgram::new();
        // 18 characters in 24 bytes fit a width of 20
        let list = comma_list(&f, &["äääá", "öööó", "üüüú"], Some(FormattingJoinPolicy::BreakAllOrNone));
        let root = f.concat(&[f.text("x "), list]);
        assert_eq!(f.render(root, &options(FormattingMode::COMPACT, 20)), "x äääá, öööó, üüüú");
        assert_eq!(f.render(root, &options(FormattingMode::COMPACT, 19)), "x äääá,\n  öööó,\n  üüüú");
    }

    #[test]
    fn join_breaks_on_overflow() {
        let f = FormattingProgram::new();
        let list = comma_list(&f, &["aaaa", "bbbb", "cccc"], Some(FormattingJoinPolicy::BreakOnOverflow));
        assert_eq!(f.render(list, &options(FormattingMode::COMPACT, 14)), "aaaa, bbbb,\n  cccc");
    }

    #[test]
    fn join_force_break() {
        let f = FormattingProgram::new();
        let list = comma_list(&f, &["a", "b"], Some(FormattingJoinPolicy::ForceBreak));
        assert_eq!(f.render(list, &options(FormattingMode::COMPACT, 120)), "a,\n  b");
        assert_eq!(f.render(list, &options(FormattingMode::INLINE, 120)), "a, b");
        // A forced break inside a parenthesis breaks the parenthesis as well, the items of the list line up
        let parens = f.parenthesized(list);
        assert_eq!(f.render(parens, &options(FormattingMode::COMPACT, 120)), "(\n  a,\n  b\n)");
        // Other joins keep their hanging indentation there
        let items = [f.text("a"), f.text("b")];
        let join = f.join(&items, f.text(" "), f.break_(), Some(FormattingJoinPolicy::ForceBreak), true);
        assert_eq!(f.render(f.parenthesized(join), &options(FormattingMode::COMPACT, 120)), "(\n  a\n    b\n)");
    }

    #[test]
    fn default_join_policy_depends_on_mode() {
        let mut f = FormattingProgram::new();
        let overflow = comma_list(&f, &["a"; 3], None);
        let mut config = FormattingConfigT::default();
        config.mode = FormattingMode::PRETTY;
        f.set_config(&config);
        let all_or_none = comma_list(&f, &["a"; 3], None);
        assert_eq!(f.program.borrow()[overflow as usize].join_policy, FormattingJoinPolicy::BreakOnOverflow);
        assert_eq!(f.program.borrow()[all_or_none as usize].join_policy, FormattingJoinPolicy::BreakAllOrNone);
        f.reset();
        assert_eq!(f.program.borrow().len(), 1);
    }

    #[test]
    fn parenthesis_breaks_when_too_wide() {
        let f = FormattingProgram::new();
        let inner = f.text("0123456789");
        let root = f.concat(&[f.text("f"), f.parenthesized(inner)]);
        assert_eq!(f.render(root, &options(FormattingMode::COMPACT, 15)), "f(0123456789)");
        assert_eq!(f.render(root, &options(FormattingMode::COMPACT, 14)), "f(\n  0123456789\n)");
    }

    #[test]
    fn overflowing_parenthesis_keeps_inline_separator() {
        let f = FormattingProgram::new();
        let items = [f.text("aaaa"), f.parenthesized(f.text("bbbbbbbb"))];
        let join = f.join(&items, f.text(" "), f.break_(), Some(FormattingJoinPolicy::BreakOnOverflow), false);
        assert_eq!(f.render(join, &options(FormattingMode::COMPACT, 12)), "aaaa (\n  bbbbbbbb\n)");
    }

    #[test]
    fn indentation_and_debug_mode() {
        let f = FormattingProgram::new();
        let root = f.concat(&[f.text("a"), f.indented(f.concat(&[f.break_(), f.text("b")]))]);
        let mut opts = options(FormattingMode::COMPACT, 120);
        opts.indentation_width = 4;
        assert_eq!(f.render(root, &opts), "a\n    b");
        opts.debug_mode = true;
        assert_eq!(f.render(root, &opts), "a /*1*/\n    b");
    }

    #[test]
    fn upper_cases_keywords_of_generated_text() {
        let f = FormattingProgram::new();
        let root = f.concat(&[f.text("select foo_bar, y1"), f.text(" from "), f.verbatim("select")]);
        let mut opts = options(FormattingMode::COMPACT, 120);
        opts.keyword_case = KeywordCase::UPPER;
        assert_eq!(f.render(root, &opts), "SELECT foo_bar, y1 FROM select");
        // Only lower-case words are keywords
        let mixed = f.text("Select order1 'between'");
        assert_eq!(f.render(mixed, &opts), "Select order1 'BETWEEN'");
    }
}
