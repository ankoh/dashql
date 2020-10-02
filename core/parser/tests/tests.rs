use parser;

#[cfg(target_pointer_width = "32")]
mod tests {
    use super::parser::{dashql_lexer, dashql_parser};

    #[test]
    fn parse_foo() -> Result<(), Box<dyn std::error::Error>> {
        let input = "foo";

        let lexerdef = dashql_lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = dashql_parser::parse(&lexer);

        assert_eq!(result.ok_or("Error")??, true);
        assert_eq!(errors.len(), 0);

        Ok(())
    }
}
