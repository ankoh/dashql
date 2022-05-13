use super::analysis_settings::ProgramAnalysisSettings;
use super::program_analysis::{analyze_program, InputValue, ProgramAnalysis};
pub use dashql_proto::syntax as sx;
use std::error::Error;
use std::rc::Rc;

use crate::grammar::Program;

pub struct ProgramInstance<'arena> {
    pub arena: &'arena bumpalo::Bump,
    pub text: &'arena str,
    pub program_proto: sx::Program<'arena>,
    pub program: Rc<Program<'arena>>,
    pub analysis: ProgramAnalysis<'arena>,
    pub input: Vec<InputValue>,
}

impl<'arena> ProgramInstance<'arena> {
    pub fn instantiate(
        settings: Rc<ProgramAnalysisSettings>,
        arena: &'arena bumpalo::Bump,
        text: &'arena str,
        program_proto: sx::Program<'arena>,
        program: Rc<Program<'arena>>,
        input: Vec<InputValue>,
    ) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let analysis = analyze_program(settings, arena, text, program_proto, program.clone(), &input)?;
        Ok(Self {
            arena,
            text,
            program_proto: program_proto,
            program,
            analysis,
            input,
        })
    }
}
