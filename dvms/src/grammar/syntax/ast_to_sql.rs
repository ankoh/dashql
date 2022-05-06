use std::cell::Cell;

pub enum SQLTextElement<'arena, 'text> {
    Comma,
    Semicolon,
    AttributeEqual,
    InlineSpace,
    Stack(&'arena [SQLText<'arena, 'text>]),
    Float(&'arena [SQLText<'arena, 'text>]),
    RoundBrackets(&'arena [SQLText<'arena, 'text>]),
    Keyword(&'static str),
    TextDynamic(&'text str),
    TextStatic(&'static str),
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
        visited: bool
    }
    let mut pending: Vec<DFSNode<'arena, 'text>> = Vec::new();
    pending.push(DFSNode { text: text, visited: false });
    while !pending.is_empty() {
        let top = pending.last().unwrap().clone();
        if !top.visited {
            pending.last_mut().unwrap().visited = true;
            match top.text.element {
                SQLTextElement::Stack(elems) | SQLTextElement::Float(elems) => {
                    for elem in elems.iter().rev() {
                        pending.push(DFSNode { 
                            text: elem,
                            visited: false
                        });
                    }
                },
                SQLTextElement::RoundBrackets(elems) => {
                    for elem in elems.iter().rev() {
                        pending.push(DFSNode { 
                            text: elem,
                            visited: false
                        });
                    }
                },
                _ => {},
            }
        } else {
            pending.pop();
            match top.text.element {
                SQLTextElement::InlineSpace => {
                    top.text.inline_text_length.set(1);
                },
                SQLTextElement::Comma => {
                    top.text.inline_text_length.set(2);
                },
                SQLTextElement::Semicolon => {
                    top.text.inline_text_length.set(1);
                },
                SQLTextElement::AttributeEqual => {
                    top.text.inline_text_length.set(3);
                },
                SQLTextElement::Keyword(s) => {
                    top.text.inline_text_length.set(s.len());
                },
                SQLTextElement::TextDynamic(s) => {
                    top.text.inline_text_length.set(s.len());
                },
                SQLTextElement::TextStatic(s) => {
                    top.text.inline_text_length.set(s.len());
                },
                SQLTextElement::Stack(elems) | SQLTextElement::Float(elems) => {
                    let mut length = 0;
                    for elem in elems.iter() {
                        length += elem.inline_text_length.get();
                    }
                    top.text.inline_text_length.set(length);
                },
                SQLTextElement::RoundBrackets(elems) => {
                    let mut length = 2;
                    for elem in elems.iter() {
                        length += elem.inline_text_length.get();
                    }
                    top.text.inline_text_length.set(length);
                }
            }
        }
    }
}

pub struct SQLWriterConfig {
    indent_by: usize,
    max_width: usize,
}

pub fn write_sql_string<'arena, 'text>(text: &SQLText<'arena, 'text>) {
    compute_inline_lengths(text);

}
