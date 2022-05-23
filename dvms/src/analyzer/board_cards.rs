use super::board_space::BoardSpace;
use super::program_instance::ProgramInstance;
use std::error::Error;

pub fn derive_board_cards<'a>(ctx: &ProgramInstance<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    let mut space = BoardSpace::default();

    Ok(())
}
