use crate::grammar;

use super::ast_node::*;
use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;
use std::error::Error;

#[derive(Debug, Clone)]
pub enum Statement<'arena> {
    Select(&'arena SelectStatement<'arena>),
    Input(&'arena InputStatement<'arena>),
    Fetch(&'arena FetchStatement<'arena>),
    Load(&'arena LoadStatement<'arena>),
    Viz(&'arena VizStatement<'arena>),
    Create(&'arena CreateStatement<'arena>),
    CreateAs(&'arena CreateAsStatement<'arena>),
    CreateView(&'arena CreateViewStatement<'arena>),
    Set(&'arena SetStatement<'arena>),
}

#[derive(Clone, Default)]
pub struct Program<'arena> {
    pub nodes: Vec<ASTNode<'arena>>,
    pub statements: Vec<Statement<'arena>>,
}

impl<'arena> std::fmt::Debug for Program<'arena> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Program").field("statements", &self.statements).finish()
    }
}

#[allow(dead_code)]
pub struct ProgramContainer {
    arena: bumpalo::Bump,
    text: &'static str,
    program: Program<'static>,
}

impl ProgramContainer {
    pub fn parse(text: &str) -> Result<Self, Box<dyn Error + Send + Sync>> {
        // Parse and deserialize the text
        let arena = bumpalo::Bump::new();
        let text = arena.alloc_str(text);
        let ast = grammar::parse(&arena, &text)?;
        let program = grammar::deserialize_ast(&arena, &text, ast).unwrap();

        // Now transmute the lifetimes
        let text_static = unsafe { std::mem::transmute::<&str, &'static str>(text) };
        let program_static =
            unsafe { std::mem::transmute::<&grammar::Program<'_>, &grammar::Program<'static>>(&program) };
        Ok(Self {
            arena,
            text: text_static,
            program: program_static.clone(),
        })
    }

    pub fn get_arena<'buffer>(&'buffer self) -> &'buffer bumpalo::Bump {
        &self.arena
    }
    pub fn get_text<'buffer>(&'buffer self) -> &'buffer str {
        &self.text
    }
    pub fn get_program<'buffer>(&'buffer self) -> &'buffer Program<'buffer> {
        unsafe { std::mem::transmute::<&'buffer Program<'static>, &'buffer Program<'buffer>>(&self.program) }
    }
}