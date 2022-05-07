use std::cell::Cell;

pub enum SQLTextElement<'arena, 'text> {
    InlineSpace,
    StaticStr(&'static str),
    DynamicStr(&'text str),
    Stack(&'arena [SQLText<'arena, 'text>]),
    Float(&'arena [SQLText<'arena, 'text>]),
    Brackets(&'static str, &'static str, &'arena [SQLText<'arena, 'text>]),
    Keyword(&'static str),
}

pub struct SQLText<'arena, 'text> {
    pub element: SQLTextElement<'arena, 'text>,
    pub inline_text_length: Cell<usize>,
}

pub trait SQLWritable<'text> {
    fn as_sql<'arena>(arena: &'arena bumpalo::Bump) -> SQLText<'arena, 'text>;
}

fn compute_inline_lengths<'arena, 'text>(text: &'arena SQLText<'arena, 'text>) {
    #[derive(Clone)]
    struct DFSNode<'arena, 'text> {
        text: &'arena SQLText<'arena, 'text>,
        visited: bool,
    }
    let mut pending: Vec<DFSNode<'arena, 'text>> = Vec::new();
    pending.push(DFSNode {
        text: text,
        visited: false,
    });

    while !pending.is_empty() {
        let top = pending.last().unwrap().clone();
        if !top.visited {
            pending.last_mut().unwrap().visited = true;
            match top.text.element {
                SQLTextElement::Stack(elems) | SQLTextElement::Float(elems) => {
                    for elem in elems.iter().rev() {
                        pending.push(DFSNode {
                            text: elem,
                            visited: false,
                        });
                    }
                }
                SQLTextElement::Brackets(_, _, elems) => {
                    for elem in elems.iter().rev() {
                        pending.push(DFSNode {
                            text: elem,
                            visited: false,
                        });
                    }
                }
                _ => {}
            }
        } else {
            pending.pop();
            match top.text.element {
                SQLTextElement::InlineSpace => {
                    top.text.inline_text_length.set(1);
                }
                SQLTextElement::StaticStr(s) => {
                    top.text.inline_text_length.set(s.len());
                }
                SQLTextElement::DynamicStr(s) => {
                    top.text.inline_text_length.set(s.len());
                }
                SQLTextElement::Stack(elems) | SQLTextElement::Float(elems) => {
                    let mut length = 0;
                    for elem in elems.iter() {
                        length += elem.inline_text_length.get();
                    }
                    top.text.inline_text_length.set(length);
                }
                SQLTextElement::Brackets(bropen, brclose, elems) => {
                    let mut length = bropen.len() + brclose.len();
                    for elem in elems.iter() {
                        length += elem.inline_text_length.get();
                    }
                    top.text.inline_text_length.set(length);
                }
                _ => {}
            }
        }
    }
}

pub struct SQLWriterConfig {
    indent_by: usize,
    max_width: usize,
}

pub fn write_sql_string<'arena, 'text>(text: &'arena SQLText<'arena, 'text>, config: &SQLWriterConfig) {
    compute_inline_lengths(text);

    #[derive(Clone)]
    struct DFSNode<'arena, 'text> {
        text: &'arena SQLText<'arena, 'text>,
        visited: bool,
        break_to: usize,
        inline: bool,
    }
    let mut pending: Vec<DFSNode<'arena, 'text>> = Vec::new();
    pending.push(DFSNode {
        text,
        visited: false,
        break_to: 0,
        inline: true,
    });

    let mut buffer = String::new();
    let mut writer_offset = 0_usize;

    while !pending.is_empty() {
        let top = pending.last().unwrap().clone();
        let inline_text_length = top.text.inline_text_length.get();

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
