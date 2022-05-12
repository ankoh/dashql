use super::program_analysis::{analyze_program, InputValue, ProgramAnalysis};
pub use dashql_proto::syntax as sx;
use std::error::Error;

pub struct ProgramInstance<'arena> {
    pub arena: &'arena bumpalo::Bump,
    pub text: &'arena str,
    pub program: sx::Program<'arena>,
    pub analysis: ProgramAnalysis<'arena>,
    pub input: Vec<InputValue>,
}

impl<'arena> ProgramInstance<'arena> {
    pub fn instantiate(
        arena: &'arena bumpalo::Bump,
        text: &'arena str,
        program: sx::Program<'arena>,
        input: Vec<InputValue>,
    ) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let analysis = analyze_program(arena, text, program, &input)?;
        Ok(Self {
            arena,
            text,
            program,
            analysis,
            input,
        })
    }
}
