#[derive(Debug, Clone)]
pub enum ScriptTextElement<'arena> {
    InlineSpace,
    StaticStr(&'static str),
    DynamicStr(&'arena str),
    Stack(&'arena [ScriptText<'arena>]),
    Float(&'arena [ScriptText<'arena>]),
    Block(&'arena [ScriptText<'arena>]),
    Brackets(&'static str, &'static str, &'arena [ScriptText<'arena>]),
    Keyword(&'static str),
}

#[derive(Debug, Clone)]
pub struct ScriptText<'arena> {
    pub element: ScriptTextElement<'arena>,
    pub inline_length: usize,
}

impl<'arena> Default for ScriptText<'arena> {
    fn default() -> Self {
        ScriptText {
            element: ScriptTextElement::InlineSpace,
            inline_length: 1,
        }
    }
}

pub struct ScriptWriter<'arena> {
    arena: &'arena bumpalo::Bump,
}

impl<'arena> ScriptWriter<'arena> {
    pub fn with_arena(arena: &'arena bumpalo::Bump) -> Self {
        Self { arena }
    }
}

impl<'arena> ScriptWriter<'arena> {
    pub fn space(&self) -> ScriptText<'arena> {
        ScriptText {
            element: ScriptTextElement::InlineSpace,
            inline_length: 1,
        }
    }
    pub fn str_const(&self, s: &'static str) -> ScriptText<'arena> {
        ScriptText {
            element: ScriptTextElement::StaticStr(s),
            inline_length: s.len(),
        }
    }
    pub fn str(&self, s: &'arena str) -> ScriptText<'arena> {
        ScriptText {
            element: ScriptTextElement::DynamicStr(s),
            inline_length: s.len(),
        }
    }
    pub fn stack(&self, elems: &'arena [ScriptText<'arena>]) -> ScriptText<'arena> {
        let mut len = 0;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        ScriptText {
            element: ScriptTextElement::Stack(elems),
            inline_length: len,
        }
    }
    pub fn float(&self, elems: &'arena [ScriptText<'arena>]) -> ScriptText<'arena> {
        let mut len = 0;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        ScriptText {
            element: ScriptTextElement::Float(elems),
            inline_length: len,
        }
    }
    pub fn block(&self, elems: &'arena [ScriptText<'arena>]) -> ScriptText<'arena> {
        let mut len = 0;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        ScriptText {
            element: ScriptTextElement::Block(elems),
            inline_length: len,
        }
    }
    pub fn round_brackets(&self, elems: &'arena [ScriptText<'arena>]) -> ScriptText<'arena> {
        let mut len = 2;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        ScriptText {
            element: ScriptTextElement::Brackets("(", ")", elems),
            inline_length: len,
        }
    }
    pub fn square_brackets(&self, elems: &'arena [ScriptText<'arena>]) -> ScriptText<'arena> {
        let mut len = 2;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        ScriptText {
            element: ScriptTextElement::Brackets("[", "]", elems),
            inline_length: len,
        }
    }
    pub fn single_quotes(&self, elem: ScriptText<'arena>) -> ScriptText<'arena> {
        let array: &mut [ScriptText<'arena>] = self.arena.alloc_slice_fill_default(3);
        let len = elem.inline_length + 2;
        array[0] = self.str_const("'");
        array[1] = elem;
        array[2] = self.str_const("'");
        ScriptText {
            element: ScriptTextElement::Block(array),
            inline_length: len,
        }
    }
    pub fn keyword(&self, k: &'static str) -> ScriptText<'arena> {
        ScriptText {
            element: ScriptTextElement::Keyword(k),
            inline_length: k.len(),
        }
    }
}

pub struct ScriptTextArray<'arena> {
    array: &'arena mut [ScriptText<'arena>],
    writer: usize,
}

impl<'arena> ScriptTextArray<'arena> {
    pub fn with_capacity(writer: &ScriptWriter<'arena>, cap: usize) -> Self {
        debug_assert!(cap > 0, "array capacity must be > 0");
        let array: &mut [ScriptText<'arena>] = writer.arena.alloc_slice_fill_default(cap);
        Self { array, writer: 0 }
    }
    pub fn with_pushed(mut self, elem: ScriptText<'arena>) -> Self {
        self.array[self.writer.min(self.array.len() - 1)] = elem;
        self.writer += 1;
        self
    }
    pub fn push(&mut self, elem: ScriptText<'arena>) {
        self.array[self.writer.min(self.array.len() - 1)] = elem;
        self.writer += 1;
    }
    pub fn finish(self) -> &'arena [ScriptText<'arena>] {
        &self.array[0..self.writer]
    }
}

pub trait AsScript {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, writer: &ScriptWriter<'writer>) -> ScriptText<'writer>;
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

pub fn write_script_string<'arena>(root: &'arena ScriptText<'arena>, config: &ScriptTextConfig) -> String {
    #[derive(Clone)]
    struct DFSNode<'arena> {
        text: &'arena ScriptText<'arena>,
        visited: bool,
        break_to: usize,
        inline: bool,
    }
    let mut pending: Vec<DFSNode<'arena>> = Vec::new();
    pending.push(DFSNode {
        text: root,
        visited: false,
        break_to: 0,
        inline: true,
    });

    let mut buffer = String::new();
    let mut writer_offset = 0_usize;

    while !pending.is_empty() {
        let top = pending.last().unwrap().clone();
        let inline_text_length = top.text.inline_length;

        if !top.visited {
            pending.last_mut().unwrap().visited = true;

            if !top.inline {
                buffer.push_str("\n");
                buffer.push_str(&" ".repeat(top.break_to * config.indent_by));
                writer_offset = top.break_to * config.indent_by;
            }

            match top.text.element {
                ScriptTextElement::InlineSpace => {
                    if top.inline {
                        buffer.push_str(" ");
                        writer_offset += 1;
                    }
                }
                ScriptTextElement::Keyword(s) | ScriptTextElement::StaticStr(s) => {
                    buffer.push_str(s);
                    writer_offset += s.len();
                }
                ScriptTextElement::DynamicStr(s) => {
                    buffer.push_str(s);
                    writer_offset += s.len();
                }
                ScriptTextElement::Block(elems) => {
                    for elem in elems.iter().rev() {
                        pending.push(DFSNode {
                            text: elem,
                            visited: false,
                            break_to: top.break_to,
                            inline: true,
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
                                inline: i == 0,
                            });
                        }
                    } else {
                        for elem in elems.iter().rev() {
                            pending.push(DFSNode {
                                text: elem,
                                visited: false,
                                break_to: top.break_to,
                                inline: true,
                            });
                        }
                    }
                }
                ScriptTextElement::Float(elems) => {
                    if (writer_offset + inline_text_length) <= config.max_width {
                        for elem in elems.iter().rev() {
                            pending.push(DFSNode {
                                text: elem,
                                visited: false,
                                break_to: top.break_to,
                                inline: true,
                            });
                        }
                    } else {
                        let begin = pending.len();
                        for elem in elems.iter() {
                            let inline_text_length = elem.inline_length;
                            if (writer_offset + inline_text_length) > config.max_width {
                                pending.push(DFSNode {
                                    text: elem,
                                    visited: false,
                                    break_to: top.break_to,
                                    inline: false,
                                });
                            } else {
                                pending.push(DFSNode {
                                    text: elem,
                                    visited: false,
                                    break_to: top.break_to,
                                    inline: true,
                                });
                            }
                            pending[begin..].reverse();
                        }
                    }
                }
                ScriptTextElement::Brackets(bropen, _, elems) => {
                    buffer.push_str(bropen);
                    writer_offset += 1;
                    for elem in elems.iter().rev() {
                        let inline_text_length = elem.inline_length;
                        if (writer_offset + inline_text_length) > config.max_width {
                            pending.push(DFSNode {
                                text: elem,
                                visited: false,
                                break_to: top.break_to,
                                inline: false,
                            });
                            writer_offset = top.break_to;
                            writer_offset += inline_text_length;
                        } else {
                            pending.push(DFSNode {
                                text: elem,
                                visited: false,
                                break_to: top.break_to,
                                inline: true,
                            });
                        }
                    }
                }
            }
        } else {
            pending.pop();

            match top.text.element {
                ScriptTextElement::Brackets(_, brclose, _) => {
                    if !top.inline {
                        buffer.push_str("\n");
                        buffer.push_str(&" ".repeat(top.break_to * config.indent_by));
                        writer_offset = top.break_to * config.indent_by;
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
