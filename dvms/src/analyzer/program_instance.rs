use super::program_analysis::ProgramAnalysis;
pub use dashql_proto::syntax as sx;

pub struct ProgramInstance<'arena> {
    pub arena: &'arena bumpalo::Bump,
    pub text: &'arena str,
    pub program: sx::Program<'arena>,
    pub analysis: ProgramAnalysis<'arena>,
}
