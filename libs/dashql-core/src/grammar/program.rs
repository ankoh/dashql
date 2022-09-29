use crate::external::parser::parse_into;
use crate::grammar;

use super::ast_node::*;
use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;
use std::error::Error;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub enum Statement<'arena> {
    Select(&'arena SelectStatement<'arena>),
    Declare(&'arena DeclareStatement<'arena>),
    Import(&'arena ImportStatement<'arena>),
    Load(&'arena LoadStatement<'arena>),
    Viz(&'arena VizStatement<'arena>),
    Create(&'arena CreateStatement<'arena>),
    CreateAs(&'arena CreateAsStatement<'arena>),
    CreateView(&'arena CreateViewStatement<'arena>),
    Set(&'arena SetStatement<'arena>),
}

#[derive(Clone)]
pub struct Program<'arena> {
    pub program_id: u32,
    pub ast_data: &'arena [u8],
    pub ast_flat: dashql_proto::Program<'arena>,
    pub ast_translated: Vec<ASTNode<'arena>>,
    pub statements: Vec<Statement<'arena>>,
}

impl<'arena> std::fmt::Debug for Program<'arena> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Program").field("statements", &self.statements).finish()
    }
}

#[allow(dead_code)]
#[derive(Clone)]
pub struct ProgramContainer {
    arena: Arc<bumpalo::Bump>,
    text: &'static str,
    program: Arc<Program<'static>>,
}

impl ProgramContainer {
    pub async fn parse(text: &str) -> Result<Self, Box<dyn Error + Send + Sync>> {
        // Parse and deserialize the text
        let arena = bumpalo::Bump::new();
        let text = arena.alloc_str(text);
        let (ast, ast_data) = parse_into(&arena, &text).await?;
        let program = Arc::new(grammar::deserialize_ast(&arena, &text, ast, ast_data).unwrap());

        // Now transmute the lifetimes
        let text_static = unsafe { std::mem::transmute::<&str, &'static str>(text) };
        let program_static =
            unsafe { std::mem::transmute::<&Arc<grammar::Program<'_>>, &Arc<grammar::Program<'static>>>(&program) };

        Ok(Self {
            arena: Arc::new(arena),
            text: text_static,
            program: program_static.clone(),
        })
    }

    pub fn clone(&self) -> Self {
        // Deserialize the ast into a separate bump allocator
        let arena = bumpalo::Bump::new();
        let text = arena.alloc_str(self.text);
        let (ast, ast_data) = (self.program.ast_flat.clone(), self.program.ast_data.clone());
        let program = Arc::new(grammar::deserialize_ast(&arena, &text, ast, ast_data).unwrap());

        // Now transmute the lifetimes
        let text_static = unsafe { std::mem::transmute::<&str, &'static str>(text) };
        let program_static =
            unsafe { std::mem::transmute::<&Arc<grammar::Program<'_>>, &Arc<grammar::Program<'static>>>(&program) };

        Self {
            arena: Arc::new(arena),
            text: text_static,
            program: program_static.clone(),
        }
    }

    pub fn get_arena<'buffer>(&'buffer self) -> &'buffer bumpalo::Bump {
        &self.arena
    }
    pub fn get_text<'buffer>(&'buffer self) -> &'buffer str {
        &self.text
    }
    pub fn get_program<'buffer>(&'buffer self) -> &'buffer Arc<Program<'buffer>> {
        unsafe { std::mem::transmute::<&'buffer Arc<Program<'static>>, &'buffer Arc<Program<'buffer>>>(&self.program) }
    }
}

impl serde::Serialize for ProgramContainer {
    fn serialize<S>(&self, ser: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        ser.serialize_str(self.text)
    }
}

impl Default for ProgramContainer {
    fn default() -> Self {
        Self {
            arena: Arc::new(bumpalo::Bump::new()),
            text: "",
            program: Arc::new(Program {
                program_id: 0,
                ast_data: &[],
                ast_flat: dashql_proto::Program {
                    _tab: flatbuffers::Table { buf: &[], loc: 0 },
                },
                ast_translated: Vec::new(),
                statements: Vec::new(),
            }),
        }
    }
}

impl std::fmt::Debug for ProgramContainer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProgramContainer").field("text", &self.text).finish()
    }
}
