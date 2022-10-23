use std::cell::Cell;

use super::{ast_to_sql::NoopExpressionFilter, Expression, Program};

#[derive(Debug, Clone)]
pub enum ScriptTextElement<'writer> {
    Void,
    StaticStr(&'static str),
    DynamicStr(&'writer str),
    Stack(&'writer [ScriptText<'writer>]),
    Float(&'writer [ScriptText<'writer>]),
    Block(&'writer [ScriptText<'writer>]),
    Brackets(&'static str, &'static str, &'writer [ScriptText<'writer>]),
    Keyword(&'static str),
}

#[derive(Debug, Clone)]
pub struct ScriptText<'writer> {
    pub element: ScriptTextElement<'writer>,
    pub breakpoint_before: Cell<bool>,
    pub space_before: Cell<bool>,
    pub space_after: Cell<bool>,
    pub inline_length: usize,
}

impl<'writer> ScriptText<'writer> {
    pub fn pad_left(mut self) -> Self {
        self.inline_length += (!self.space_before.get()) as usize;
        self.space_before.set(true);
        self
    }
    pub fn pad_right(mut self) -> Self {
        self.inline_length += (!self.space_after.get()) as usize;
        self.space_after.set(true);
        self
    }
    pub fn breakpoint_before(self) -> Self {
        self.breakpoint_before.set(true);
        self
    }
    pub fn set_breakpoint_before(&self) -> &Self {
        self.breakpoint_before.set(true);
        self
    }
}

impl<'arena> Default for ScriptText<'arena> {
    fn default() -> Self {
        ScriptText {
            element: ScriptTextElement::Void,
            breakpoint_before: Cell::new(false),
            space_before: Cell::new(false),
            space_after: Cell::new(false),
            inline_length: 1,
        }
    }
}

pub struct ScriptWriter {
    pub arena: bumpalo::Bump,
}

impl ScriptWriter {
    pub fn new() -> Self {
        Self {
            arena: bumpalo::Bump::new(),
        }
    }
    pub fn with_arena(arena: bumpalo::Bump) -> Self {
        Self { arena }
    }
    pub fn alloc_slice<'writer>(&'writer self, elems: &[ScriptText<'writer>]) -> &'writer [ScriptText<'writer>] {
        self.arena.alloc_slice_clone(elems)
    }
}

impl ScriptWriter {
    pub fn str_const<'writer>(&'writer self, s: &'static str) -> ScriptText<'writer> {
        ScriptText {
            element: ScriptTextElement::StaticStr(s),
            breakpoint_before: Cell::new(false),
            space_before: Cell::new(false),
            space_after: Cell::new(false),
            inline_length: s.len(),
        }
    }
    pub fn str<'writer>(&'writer self, s: &'writer str) -> ScriptText<'writer> {
        ScriptText {
            element: ScriptTextElement::DynamicStr(s),
            breakpoint_before: Cell::new(false),
            space_before: Cell::new(false),
            space_after: Cell::new(false),
            inline_length: s.len(),
        }
    }
    pub fn stack<'writer>(&'writer self, elems: &'writer [ScriptText<'writer>]) -> ScriptText<'writer> {
        let mut len = 0;
        for elem in elems.iter() {
            len += elem.inline_length;
            elem.set_breakpoint_before();
        }
        ScriptText {
            element: ScriptTextElement::Stack(elems),
            breakpoint_before: Cell::new(false),
            space_before: Cell::new(false),
            space_after: Cell::new(false),
            inline_length: len,
        }
    }
    pub fn float<'writer>(&'writer self, elems: &'writer [ScriptText<'writer>]) -> ScriptText<'writer> {
        let mut len = 0;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        ScriptText {
            element: ScriptTextElement::Float(elems),
            breakpoint_before: Cell::new(false),
            space_before: Cell::new(false),
            space_after: Cell::new(false),
            inline_length: len,
        }
    }
    pub fn block<'writer>(&'writer self, elems: &'writer [ScriptText<'writer>]) -> ScriptText<'writer> {
        let mut len = 0;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        ScriptText {
            element: ScriptTextElement::Block(elems),
            breakpoint_before: Cell::new(false),
            space_before: Cell::new(false),
            space_after: Cell::new(false),
            inline_length: len,
        }
    }
    pub fn brackets_one<'writer>(
        &'writer self,
        elem: ScriptText<'writer>,
        chars: [&'static str; 2],
    ) -> ScriptText<'writer> {
        let len = elem.inline_length;
        let elems = self.arena.alloc_slice_clone(&[elem]);
        ScriptText {
            element: ScriptTextElement::Brackets(chars[0], chars[1], elems),
            breakpoint_before: Cell::new(false),
            space_before: Cell::new(false),
            space_after: Cell::new(false),
            inline_length: len,
        }
    }
    pub fn round_brackets_one<'writer>(&'writer self, elem: ScriptText<'writer>) -> ScriptText<'writer> {
        self.brackets_one(elem, ["(", ")"])
    }
    pub fn round_brackets<'writer>(&'writer self, elems: &'writer [ScriptText<'writer>]) -> ScriptText<'writer> {
        let mut len = 2;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        ScriptText {
            element: ScriptTextElement::Brackets("(", ")", elems),
            breakpoint_before: Cell::new(false),
            space_before: Cell::new(false),
            space_after: Cell::new(false),
            inline_length: len,
        }
    }
    pub fn square_brackets<'writer>(&'writer self, elems: &'writer [ScriptText<'writer>]) -> ScriptText<'writer> {
        let mut len = 2;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        ScriptText {
            element: ScriptTextElement::Brackets("[", "]", elems),
            breakpoint_before: Cell::new(false),
            space_before: Cell::new(false),
            space_after: Cell::new(false),
            inline_length: len,
        }
    }
    pub fn single_quotes<'writer>(&'writer self, elem: ScriptText<'writer>) -> ScriptText<'writer> {
        let array: &mut [ScriptText<'writer>] = self.arena.alloc_slice_fill_default(3);
        let len = elem.inline_length + 2;
        array[0] = self.str_const("'");
        array[1] = elem;
        array[2] = self.str_const("'");
        ScriptText {
            element: ScriptTextElement::Block(array),
            breakpoint_before: Cell::new(false),
            space_before: Cell::new(false),
            space_after: Cell::new(false),
            inline_length: len,
        }
    }
    pub fn keyword<'writer>(&'writer self, k: &'static str) -> ScriptText<'writer> {
        ScriptText {
            element: ScriptTextElement::Keyword(k),
            breakpoint_before: Cell::new(false),
            space_before: Cell::new(false),
            space_after: Cell::new(false),
            inline_length: k.len(),
        }
    }
}

pub struct ScriptTextArray<'writer> {
    array: &'writer mut [ScriptText<'writer>],
    writer: usize,
}

impl<'writer> ScriptTextArray<'writer> {
    pub fn with_capacity(writer: &'writer ScriptWriter, cap: usize) -> Self {
        let array: &mut [ScriptText<'writer>] = writer.arena.alloc_slice_fill_default(cap);
        Self { array, writer: 0 }
    }
    pub fn with_pushed(mut self, elem: ScriptText<'writer>) -> Self {
        self.array[self.writer.min(self.array.len() - 1)] = elem;
        self.writer += 1;
        self
    }
    pub fn push(&mut self, elem: ScriptText<'writer>) {
        self.array[self.writer.min(self.array.len() - 1)] = elem;
        self.writer += 1;
    }
    pub fn finish(self) -> &'writer [ScriptText<'writer>] {
        &self.array[0..self.writer]
    }
    pub fn len(&self) -> usize {
        self.writer
    }
}

pub trait ToSQLExpressionFilter<'ast> {
    fn write_expression<'writer>(&self, writer: &'writer ScriptWriter, expr: &Expression<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer;
}

pub trait ToSQL<'ast> {
    fn to_sql<'writer, 'filter>(
        &self,
        writer: &'writer ScriptWriter,
        filter: &'filter dyn ToSQLExpressionFilter<'ast>,
    ) -> ScriptText<'writer>
    where
        'ast: 'writer;
}

pub struct ScriptTextConfig {
    pub indent_by: usize,
    pub max_width: usize,
}

impl Default for ScriptTextConfig {
    fn default() -> Self {
        ScriptTextConfig {
            indent_by: 4,
            max_width: 80,
        }
    }
}

pub fn print_script<'arena>(root: &'arena ScriptText<'arena>, config: &ScriptTextConfig) -> String {
    #[derive(Clone, Debug)]
    struct DFSNode<'arena> {
        text: &'arena ScriptText<'arena>,
        visited: bool,
        break_to: usize,
        add_break: bool,
        did_break_self: bool,
    }
    let mut pending: Vec<DFSNode<'arena>> = Vec::new();
    pending.push(DFSNode {
        text: root,
        visited: false,
        break_to: 0,
        add_break: false,
        did_break_self: false,
    });

    let mut buffer = String::new();
    let mut writer_offset = 0_usize;
    let mut pending_space = false;
    let mut break_pending = false;
    let mut break_prohibited = false;

    while !pending.is_empty() {
        let top = pending.last().unwrap().clone();
        let inline_text_length = top.text.inline_length;

        if !top.visited {
            pending.last_mut().unwrap().visited = true;

            if top.add_break {
                break_pending = true;
            }
            if break_pending && top.text.breakpoint_before.get() && !break_prohibited {
                buffer.push_str("\n");
                buffer.push_str(&" ".repeat(top.break_to * config.indent_by));
                writer_offset = top.break_to * config.indent_by;
                pending.last_mut().unwrap().did_break_self = true;
                break_pending = false;
            } else if pending_space {
                buffer.push_str(" ");
                writer_offset += 1;
            } else if top.text.space_before.get() {
                buffer.push_str(" ");
                writer_offset += 1;
            }
            pending_space = false;
            if top.text.space_after.get() {
                pending_space = true;
            }

            match top.text.element {
                ScriptTextElement::Void => {}
                ScriptTextElement::Keyword(s) | ScriptTextElement::StaticStr(s) => {
                    buffer.push_str(s);
                    writer_offset += s.len();
                }
                ScriptTextElement::DynamicStr(s) => {
                    buffer.push_str(s);
                    writer_offset += s.len();
                }
                ScriptTextElement::Block(elems) => {
                    break_prohibited = true;
                    for elem in elems.iter().rev() {
                        pending.push(DFSNode {
                            text: elem,
                            visited: false,
                            break_to: top.break_to,
                            add_break: false,
                            did_break_self: false,
                        });
                    }
                }
                ScriptTextElement::Stack(elems) => {
                    if (writer_offset + inline_text_length) <= config.max_width {
                        for elem in elems.iter().rev() {
                            pending.push(DFSNode {
                                text: elem,
                                visited: false,
                                break_to: top.break_to,
                                add_break: false,
                                did_break_self: false,
                            });
                        }
                    } else {
                        for (i, elem) in elems.iter().enumerate().rev() {
                            pending.push(DFSNode {
                                text: elem,
                                visited: false,
                                break_to: top.break_to,
                                add_break: i > 0,
                                did_break_self: false,
                            });
                        }
                    }
                }
                ScriptTextElement::Float(elems) => {
                    for elem in elems.iter().rev() {
                        pending.push(DFSNode {
                            text: elem,
                            visited: false,
                            break_to: top.break_to,
                            add_break: false,
                            did_break_self: false,
                        });
                    }
                }
                ScriptTextElement::Brackets(bropen, _, elems) => {
                    buffer.push_str(bropen);
                    writer_offset += 1;
                    if !break_prohibited && (writer_offset + inline_text_length) > config.max_width {
                        pending.last_mut().unwrap().did_break_self = true;
                        for elem in elems.iter().rev() {
                            pending.push(DFSNode {
                                text: elem,
                                visited: false,
                                break_to: top.break_to + 1,
                                add_break: true,
                                did_break_self: false,
                            });
                        }
                    } else {
                        for elem in elems.iter().rev() {
                            pending.push(DFSNode {
                                text: elem,
                                visited: false,
                                break_to: top.break_to + 1,
                                add_break: false,
                                did_break_self: false,
                            });
                        }
                    }
                }
            }
        } else {
            pending.pop();

            match top.text.element {
                ScriptTextElement::Block(_) => {
                    break_prohibited = false;
                }
                ScriptTextElement::Brackets(_, brclose, _) => {
                    if top.did_break_self {
                        buffer.push_str("\n");
                        buffer.push_str(&" ".repeat(top.break_to * config.indent_by));
                        writer_offset = top.break_to * config.indent_by;
                        break_pending = false;
                    }
                    buffer.push_str(brclose);
                    writer_offset += 1;
                }
                _ => {}
            }
        }
    }
    buffer
}

pub fn print_ast_as_script<'ast, V: ToSQL<'ast>>(v: &V, config: &ScriptTextConfig) -> String {
    let writer = ScriptWriter::new();
    let filter = NoopExpressionFilter::default();
    let text: ScriptText<'_> = v.to_sql(&writer, &filter);
    print_script(&text, config)
}

pub fn print_ast_as_script_with_defaults<'ast, V: ToSQL<'ast> + ?Sized>(v: &V) -> String {
    let config = ScriptTextConfig::default();
    let writer = ScriptWriter::new();
    let filter = NoopExpressionFilter::default();
    let text: ScriptText<'_> = v.to_sql(&writer, &filter);
    print_script(&text, &config)
}

pub fn rewrite_statements<'ast>(program: &Program<'ast>, program_text: &'ast str, stmts: &[usize]) -> String {
    let config = ScriptTextConfig::default();
    let proto_nodes = program.ast_flat.nodes().unwrap();
    let proto_stmt = program.ast_flat.statements().unwrap();

    // Print statements and collect substitutions
    let mut subs = Vec::new();
    subs.reserve(stmts.len());
    for stmt_id in stmts.iter() {
        let stmt = &program.statements[*stmt_id];
        let writer = ScriptWriter::new();
        let filter = NoopExpressionFilter::default();
        let write_buffer = stmt.to_sql(&writer, &filter);
        let text = print_script(&write_buffer, &config);
        let stmt_root = proto_stmt.get(*stmt_id).root_node();
        let stmt_location = proto_nodes[stmt_root as usize].location();
        subs.push((*stmt_location, text));
    }

    // Sort substitutions by offset in the former string
    subs.sort_unstable_by_key(|(loc, _)| loc.offset());

    // Build a new buffer and apply all subsitutions
    let mut buffer = String::new();
    buffer.reserve(program_text.len());
    let mut reader = 0_usize;
    for (loc, text) in subs {
        buffer.push_str(&program_text[reader..(loc.offset() as usize)]);
        buffer.push_str(&text);
        reader = (loc.offset() + loc.length()) as usize;
    }
    buffer.push_str(&program_text[reader..]);
    buffer
}
