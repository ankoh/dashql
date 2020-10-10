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
    use super::{context, lexer, parser};

    #[test]
    fn parse_parameter_declaration() -> Result<(), Box<dyn std::error::Error>> {
        let input = "DECLARE PARAMETER foo TYPE INTEGER;";

        let lexerdef = lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = parser::parse(&lexer);

        let result = result.ok_or("Unexpected missing result")??;

        assert_eq!(errors.len(), 0);
        assert_eq!(result.len(), 1);

        let statement = match result[0] {
            context::Statement::ParameterDeclaration(parameter_declaration) => {
                Ok(parameter_declaration)
            }
            _ => Err("Unexpected statement"),
        }?;

        assert_eq!(statement.location.begin.line, 1);
        assert_eq!(statement.location.begin.column, 1);
        assert_eq!(statement.location.end.line, 1);
        assert_eq!(statement.location.end.column, 36);
        assert_eq!(statement.identifier.string, "foo");
        assert_eq!(statement.label.string, "foo");

        Ok(())
    }
}
