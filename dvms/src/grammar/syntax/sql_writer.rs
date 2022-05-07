#[derive(Debug, Clone)]
pub enum SQLTextElement<'arena> {
    InlineSpace,
    StaticStr(&'static str),
    DynamicStr(&'arena str),
    Stack(&'arena [SQLText<'arena>]),
    Float(&'arena [SQLText<'arena>]),
    Brackets(&'static str, &'static str, &'arena [SQLText<'arena>]),
    Keyword(&'static str),
}

#[derive(Debug, Clone)]
pub struct SQLText<'arena> {
    pub element: SQLTextElement<'arena>,
    pub inline_length: usize,
}

impl<'arena> Default for SQLText<'arena> {
    fn default() -> Self {
        SQLText {
            element: SQLTextElement::InlineSpace,
            inline_length: 1,
        }
    }
}

pub struct SQLWriter<'arena> {
    arena: &'arena bumpalo::Bump,
}

impl<'arena> SQLWriter<'arena> {
    pub fn inline_space(&self) -> SQLText<'arena> {
        SQLText {
            element: SQLTextElement::InlineSpace,
            inline_length: 1,
        }
    }
    pub fn str_static(&self, s: &'static str) -> SQLText<'arena> {
        SQLText {
            element: SQLTextElement::StaticStr(s),
            inline_length: s.len(),
        }
    }
    pub fn str_dynamic(&self, s: &'arena str) -> SQLText<'arena> {
        SQLText {
            element: SQLTextElement::DynamicStr(s),
            inline_length: s.len(),
        }
    }
    pub fn stack(&self, elems: &[SQLText<'arena>]) -> SQLText<'arena> {
        let mut len = 0;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        SQLText {
            element: SQLTextElement::Stack(self.arena.alloc_slice_clone(elems)),
            inline_length: len,
        }
    }
    pub fn float(&self, elems: &[SQLText<'arena>]) -> SQLText<'arena> {
        let mut len = 0;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        SQLText {
            element: SQLTextElement::Float(self.arena.alloc_slice_clone(elems)),
            inline_length: len,
        }
    }
    pub fn round_brackets(&self, elems: &[SQLText<'arena>]) -> SQLText<'arena> {
        let mut len = 2;
        for elem in elems.iter() {
            len += elem.inline_length;
        }
        SQLText {
            element: SQLTextElement::Brackets("(", ")", self.arena.alloc_slice_clone(elems)),
            inline_length: len,
        }
    }
    pub fn keyword(&self, k: &'static str) -> SQLText<'arena> {
        SQLText {
            element: SQLTextElement::Keyword(k),
            inline_length: k.len(),
        }
    }
}

pub struct SQLTextArray<'arena> {
    array: &'arena mut [SQLText<'arena>],
    writer: usize,
}

impl<'arena> SQLTextArray<'arena> {
    pub fn with_capacity(writer: &SQLWriter<'arena>, cap: usize) -> Self {
        let array: &mut [SQLText<'arena>] = writer.arena.alloc_slice_fill_default(cap);
        Self { array, writer: 0 }
    }
    pub fn push(mut self, elem: SQLText<'arena>) -> Self {
        self.array[self.writer.min(self.array.len() - 1)] = elem;
        self.writer += 1;
        self
    }
    pub fn finish(self) -> &'arena [SQLText<'arena>] {
        self.array
    }
}

pub trait SQLWritable {
    fn as_sql<'arena>(writer: &SQLWriter<'arena>) -> SQLText<'arena>;
}

pub struct SQLTextConfig {
    indent_by: usize,
    max_width: usize,
}

pub fn write_sql_string<'arena>(root: &'arena SQLText<'arena>, config: &SQLTextConfig) {
    #[derive(Clone)]
    struct DFSNode<'arena> {
        text: &'arena SQLText<'arena>,
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
                SQLTextElement::InlineSpace => {
                    if top.inline {
                        buffer.push_str(" ");
                        writer_offset += 1;
                    }
                }
                SQLTextElement::Keyword(s) | SQLTextElement::StaticStr(s) => {
                    buffer.push_str(s);
                    writer_offset += s.len();
                }
                SQLTextElement::DynamicStr(s) => {
                    buffer.push_str(s);
                    writer_offset += s.len();
                }
                SQLTextElement::Stack(elems) => {
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
                SQLTextElement::Float(elems) => {
                    if (writer_offset + inline_text_length) <= config.max_width {
                        for elem in elems.iter().rev() {
                            pending.push(DFSNode {
                                text: elem,
                                visited: false,
                                break_to: top.break_to,
                                inline: true,
                            });
                        }
                        writer_offset += inline_text_length;
                    } else {
                        let pending_len = pending.len();
                        for elem in elems.iter() {
                            if (writer_offset + inline_text_length) <= config.max_width {
                                pending.push(DFSNode {
                                    text: elem,
                                    visited: false,
                                    break_to: top.break_to,
                                    inline: true,
                                });
                                writer_offset += inline_text_length;
                            } else {
                                writer_offset = top.break_to;
                                pending.push(DFSNode {
                                    text: elem,
                                    visited: false,
                                    break_to: top.break_to,
                                    inline: false,
                                });
                                writer_offset += inline_text_length;
                            }
                            pending[pending_len..].reverse();
                        }
                    }
                }
                SQLTextElement::Brackets(bropen, _, elems) => {
                    buffer.push_str(bropen);
                    writer_offset += 1;
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
                        for elem in elems.iter().rev() {
                            pending.push(DFSNode {
                                text: elem,
                                visited: false,
                                break_to: top.break_to,
                                inline: false,
                            });
                        }
                    }
                }
            }
        } else {
            pending.pop();

            match top.text.element {
                SQLTextElement::Brackets(_, brclose, _) => {
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
}
