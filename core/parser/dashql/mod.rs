pub mod context;

#[cfg(target_pointer_width = "32")]
include!("dashql.l.i686-unknown-linux-gnu.rs");

#[cfg(target_pointer_width = "64")]
include!("dashql.l.x86_64-unknown-linux-gnu.rs");

#[cfg(target_pointer_width = "32")]
include!("dashql.y.i686-unknown-linux-gnu.rs");

#[cfg(target_pointer_width = "64")]
include!("dashql.y.x86_64-unknown-linux-gnu.rs");

pub mod lexer {
    pub use super::dashql_l::*;
}

pub mod parser {
    pub use super::dashql_y::*;
}

#[cfg(test)]
mod tests {
    use super::{lexer, parser};

    #[test]
    fn parse_parameter_declaration() -> Result<(), Box<dyn std::error::Error>> {
        let input = "declare parameter;";

        let lexerdef = lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = parser::parse(&lexer);

        assert_eq!(result.ok_or("Error")??.len(), 1);
        assert_eq!(errors.len(), 0);

        Ok(())
    }
}
