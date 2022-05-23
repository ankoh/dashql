use super::vm_program::{VMFunction, VMFunctionArgument, VMProgram};
use std::error::Error;

pub fn execute(
    prog: &VMProgram,
    func: &VMFunction,
    args: &[VMFunctionArgument],
) -> Result<(), Box<dyn Error + Send + Sync>> {
    Ok(())
}
