pub enum SQLTextElement<'text> {
    Keyword(&'static str),
    TextStatic(&'static str),
    TextDynamic(&'text str),
    LineBreak,
    Comma,
    BracketRoundBegin(u64),
    BracketRoundEnd(u64),
    IndentBegin(u64),
    IndentEnd(u64),
}

pub struct SQLWriter<'text> {
    next_id: u64,
    buffer: Vec<SQLTextElement<'text>>,
}

impl<'text> SQLWriter<'text> {
    pub fn keyword(&mut self, k: &'static str) -> &mut Self {
        self.buffer.push(SQLTextElement::Keyword(k));
        self
    }
    pub fn text_dynamic(&mut self, t: &'text str) -> &mut Self {
        self.buffer.push(SQLTextElement::TextDynamic(t));
        self
    }
    pub fn text_static(&mut self, t: &'static str) -> &mut Self {
        self.buffer.push(SQLTextElement::TextStatic(t));
        self
    }
    pub fn linebreak(&mut self) -> &mut Self {
        self.buffer.push(SQLTextElement::LineBreak);
        self
    }
    pub fn comma(&mut self) -> &mut Self {
        self.buffer.push(SQLTextElement::Comma);
        self
    }
    pub fn bracket_round_begin(&mut self) -> &mut Self {
        self
    }
}
