use parser;

#[cfg(target_pointer_width = "32")]
mod tests {
    use super::parser::{context::*, dashql_lexer, dashql_parser};

    #[test]
    fn parse_parameter_declaration() -> Result<(), Box<dyn std::error::Error>> {
        let input = "declare parameter;";

        let lexerdef = dashql_lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = dashql_parser::parse(&lexer);

        assert_eq!(result.ok_or("Error")??.len(), 1);
        assert_eq!(errors.len(), 0);

        Ok(())
    }
}
