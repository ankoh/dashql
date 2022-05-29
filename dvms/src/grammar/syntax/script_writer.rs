use std::cell::Cell;

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
    pub breakpoint_before: bool,
    pub space_before: bool,
    pub space_after: bool,
    pub inline_length: usize,
}

impl<'writer> ScriptText<'writer> {
    pub fn pad_left(mut self) -> Self {
        self.inline_length += (!self.space_before) as usize;
        self.space_before = true;
        self
    }
    pub fn pad_right(mut self) -> Self {
        self.inline_length += (!self.space_after) as usize;
        self.space_after = true;
        self
    }
    pub fn breakpoint_before(mut self) -> Self {
        self.breakpoint_before = true;
        self
    }
}

impl<'arena> Default for ScriptText<'arena> {
    fn default() -> Self {
        ScriptText {
            element: ScriptTextElement::Void,
            breakpoint_before: false,
            space_before: false,
            space_after: false,
            inline_length: 1,
        }
    }
}

pub struct ScriptWriter {
    pub arena: bumpalo::Bump,
    pub operator_precedence: Cell<Option<usize>>,
}

impl ScriptWriter {
    pub fn new() -> Self {
        Self {
            arena: bumpalo::Bump::new(),
            operator_precedence: Cell::new(None),
        }
    }
    pub fn with_arena(arena: bumpalo::Bump) -> Self {
        Self {
            arena,
            operator_precedence: Cell::new(None),
        }
    }
    pub fn alloc_slice<'writer>(&'writer self, elems: &[ScriptText<'writer>]) -> &'writer [ScriptText<'writer>] {
        self.arena.alloc_slice_clone(elems)
    }
}

impl ScriptWriter {
    pub fn str_const<'writer>(&'writer self, s: &'static str) -> ScriptText<'writer> {
        ScriptText {
            element: ScriptTextElement::StaticStr(s),
            breakpoint_before: false,
            space_before: false,
            space_after: false,
            inline_length: s.len(),
        }
    }
    pub fn str<'writer>(&'writer self, s: &'writer str) -> ScriptText<'writer> {
        ScriptText {
            element: ScriptTextElement::DynamicStr(s),
            breakpoint_before: false,
            space_before: false,
            space_after: false,
            inline_length: s.len(),
        }
    }
    pub fn stack<'writer>(&'writer self, elems: &'writer [ScriptText<'writer>]) -> ScriptText<'writer> {
        let mut len = 0;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        ScriptText {
            element: ScriptTextElement::Stack(elems),
            breakpoint_before: false,
            space_before: false,
            space_after: false,
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
            breakpoint_before: false,
            space_before: false,
            space_after: false,
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
            breakpoint_before: false,
            space_before: false,
            space_after: false,
            inline_length: len,
        }
    }
    pub fn round_brackets<'writer>(&'writer self, elems: &'writer [ScriptText<'writer>]) -> ScriptText<'writer> {
        let mut len = 2;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        ScriptText {
            element: ScriptTextElement::Brackets("(", ")", elems),
            breakpoint_before: false,
            space_before: false,
            space_after: false,
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
            breakpoint_before: false,
            space_before: false,
            space_after: false,
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
            breakpoint_before: false,
            space_before: false,
            space_after: false,
            inline_length: len,
        }
    }
    pub fn keyword<'writer>(&'writer self, k: &'static str) -> ScriptText<'writer> {
        ScriptText {
            element: ScriptTextElement::Keyword(k),
            breakpoint_before: false,
            space_before: false,
            space_after: false,
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
        debug_assert!(cap > 0, "array capacity must be > 0");
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
}

pub trait AsScript<'ast> {
    fn as_script<'writer>(&self, writer: &'writer ScriptWriter) -> ScriptText<'writer>
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
            max_width: 120,
        }
    }
}

pub fn print_script<'arena>(root: &'arena ScriptText<'arena>, config: &ScriptTextConfig) -> String {
    #[derive(Clone)]
    struct DFSNode<'arena> {
        text: &'arena ScriptText<'arena>,
        visited: bool,
        break_to: usize,
        break_at_next: bool,
        did_break_self: bool,
    }
    let mut pending: Vec<DFSNode<'arena>> = Vec::new();
    pending.push(DFSNode {
        text: root,
        visited: false,
        break_to: 0,
        break_at_next: false,
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

            if top.break_at_next {
                break_pending = true;
            }
            if top.text.breakpoint_before && break_pending && !break_prohibited {
                buffer.push_str("\n");
                buffer.push_str(&" ".repeat(top.break_to * config.indent_by));
                writer_offset = top.break_to * config.indent_by;
                pending.last_mut().unwrap().did_break_self = true;
                break_pending = false;
            } else if pending_space {
                buffer.push_str(" ");
                writer_offset += 1;
            } else if top.text.space_before {
                buffer.push_str(" ");
                writer_offset += 1;
            }
            pending_space = false;
            if top.text.space_after {
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
                            break_at_next: false,
                            did_break_self: false,
                        });
                    }
                }
                ScriptTextElement::Stack(elems) => {
                    if (writer_offset + inline_text_length) <= config.max_width {
                        for (i, elem) in elems.iter().enumerate().rev() {
                            pending.push(DFSNode {
                                text: elem,
                                visited: false,
                                break_to: top.break_to,
                                break_at_next: i > 0,
                                did_break_self: false,
                            });
                        }
                    } else {
                        for elem in elems.iter().rev() {
                            pending.push(DFSNode {
                                text: elem,
                                visited: false,
                                break_to: top.break_to,
                                break_at_next: false,
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
                            break_at_next: false,
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
                                break_at_next: true,
                                did_break_self: false,
                            });
                        }
                    } else {
                        for elem in elems.iter().rev() {
                            pending.push(DFSNode {
                                text: elem,
                                visited: false,
                                break_to: top.break_to + 1,
                                break_at_next: false,
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
                    if !break_prohibited && top.did_break_self {
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

pub fn print_ast_as_script<'ast, V: AsScript<'ast>>(v: &V, config: &ScriptTextConfig) -> String {
    let writer = ScriptWriter::new();
    let text: ScriptText<'_> = v.as_script(&writer);
    print_script(&text, config)
}

pub fn print_ast_as_script_with_defaults<'ast, V: AsScript<'ast> + ?Sized>(v: &V) -> String {
    let config = ScriptTextConfig::default();
    let writer = ScriptWriter::new();
    let text: ScriptText<'_> = v.as_script(&writer);
    print_script(&text, &config)
}
