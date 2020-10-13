pub mod syntax;

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
    use super::{lexer, parser, syntax};
    use indoc::indoc;

    #[test]
    fn parse_statements_empty() -> Result<(), Box<dyn std::error::Error>> {
        let input = "";

        let lexerdef = lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = parser::parse(&lexer);
        let (result, location) = result.ok_or("Unexpected missing result")??;

        assert_eq!(errors.len(), 0);
        assert_eq!(result.len(), 0);
        assert_eq!(location, ((1, 1), (1, 1)).into());

        Ok(())
    }

    #[test]
    fn parse_statements_multiple() -> Result<(), Box<dyn std::error::Error>> {
        let input = indoc! {"
            DECLARE PARAMETER foo TYPE INTEGER;

            DECLARE PARAMETER foo TYPE INTEGER;

            DECLARE PARAMETER foo TYPE INTEGER;
        "};

        let lexerdef = lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = parser::parse(&lexer);
        let (result, location) = result.ok_or("Unexpected missing result")??;

        assert_eq!(errors.len(), 0);
        assert_eq!(result.len(), 3);
        assert_eq!(location, ((1, 1), (5, 36)).into());

        Ok(())
    }

    #[test]
    fn parse_parameter_declaration() -> Result<(), Box<dyn std::error::Error>> {
        let input = "DECLARE PARAMETER foo TYPE INTEGER;";

        let lexerdef = lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = parser::parse(&lexer);
        let (result, _) = result.ok_or("Unexpected missing result")??;

        assert_eq!(errors.len(), 0);
        assert_eq!(result.len(), 1);

        let parameter_declaration = match &result[0] {
            syntax::Statement::ParameterDeclaration(statement) => Ok(statement),
            _ => Err("Unexpected statement"),
        }?;

        assert_eq!(parameter_declaration.location, ((1, 1), (1, 36)).into());
        assert_eq!(
            parameter_declaration.identifier.location,
            ((1, 19), (1, 22)).into()
        );
        assert_eq!(parameter_declaration.identifier.string, "foo");
        assert_eq!(parameter_declaration.label.string, "foo");

        Ok(())
    }

    #[test]
    fn parse_parameter_declaration_with_alias() -> Result<(), Box<dyn std::error::Error>> {
        let input = "DECLARE PARAMETER label AS identifier TYPE INTEGER;";

        let lexerdef = lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = parser::parse(&lexer);
        let (result, _) = result.ok_or("Unexpected missing result")??;

        assert_eq!(errors.len(), 0);
        assert_eq!(result.len(), 1);

        let parameter_declaration = match &result[0] {
            syntax::Statement::ParameterDeclaration(statement) => Ok(statement),
            _ => Err("Unexpected statement"),
        }?;

        assert_eq!(parameter_declaration.location, ((1, 1), (1, 52)).into());
        assert_eq!(
            parameter_declaration.identifier.location,
            ((1, 28), (1, 38)).into()
        );
        assert_eq!(parameter_declaration.identifier.string, "identifier");
        assert_eq!(
            parameter_declaration.label.location,
            ((1, 19), (1, 24)).into()
        );
        assert_eq!(parameter_declaration.label.string, "label");

        Ok(())
    }

    #[test]
    fn parse_load_statement_http_loader() -> Result<(), Box<dyn std::error::Error>> {
        let input = "LOAD foo FROM HTTP;";

        let lexerdef = lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = parser::parse(&lexer);
        let (result, _) = result.ok_or("Unexpected missing result")??;

        assert_eq!(errors.len(), 0);
        assert_eq!(result.len(), 1);

        let load_statement = match &result[0] {
            syntax::Statement::LoadStatement(statement) => Ok(statement),
            _ => Err("Unexpected statement"),
        }?;

        assert_eq!(load_statement.location, ((1, 1), (1, 20)).into());
        assert_eq!(load_statement.identifier.location, ((1, 6), (1, 9)).into());
        assert_eq!(load_statement.identifier.string, "foo");

        let http_loader = match &load_statement.method {
            syntax::LoadMethod::Http(loader) => Ok(loader),
            _ => Err("Unexpected loader"),
        }?;

        assert_eq!(http_loader.location, ((1, 15), (1, 19)).into());
        assert_eq!(http_loader.attributes, None);

        Ok(())
    }

    #[test]
    fn parse_load_statement_http_loader_with_attributes_empty(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let input = "LOAD foo FROM HTTP ();";

        let lexerdef = lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = parser::parse(&lexer);
        let (result, _) = result.ok_or("Unexpected missing result")??;

        assert_eq!(errors.len(), 0);
        assert_eq!(result.len(), 1);

        let load_statement = match &result[0] {
            syntax::Statement::LoadStatement(statement) => Ok(statement),
            _ => Err("Unexpected statement"),
        }?;

        assert_eq!(load_statement.location, ((1, 1), (1, 23)).into());
        assert_eq!(load_statement.identifier.location, ((1, 6), (1, 9)).into());
        assert_eq!(load_statement.identifier.string, "foo");

        let http_loader = match &load_statement.method {
            syntax::LoadMethod::Http(loader) => Ok(loader),
            _ => Err("Unexpected loader"),
        }?;

        assert_eq!(http_loader.location, ((1, 15), (1, 22)).into());

        let http_attributes = http_loader
            .clone()
            .attributes
            .ok_or("Unexpected missing attributes")?;

        assert_eq!(http_attributes.location, ((1, 20), (1, 22)).into());
        assert_eq!(http_attributes.attributes, vec![]);

        Ok(())
    }

    #[test]
    fn parse_load_statement_http_loader_with_attributes() -> Result<(), Box<dyn std::error::Error>>
    {
        let input = indoc! {r#"
            LOAD foo FROM HTTP (
                METHOD = GET,
                URL = 'https://example.com/data.csv'
            );
        "#};

        let lexerdef = lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = parser::parse(&lexer);
        let (result, _) = result.ok_or("Unexpected missing result")??;

        assert_eq!(errors.len(), 0);
        assert_eq!(result.len(), 1);

        let load_statement = match &result[0] {
            syntax::Statement::LoadStatement(statement) => Ok(statement),
            _ => Err("Unexpected statement"),
        }?;

        assert_eq!(load_statement.location, ((1, 1), (4, 3)).into());
        assert_eq!(load_statement.identifier.location, ((1, 6), (1, 9)).into());
        assert_eq!(load_statement.identifier.string, "foo");

        let http_loader = match &load_statement.method {
            syntax::LoadMethod::Http(loader) => Ok(loader),
            _ => Err("Unexpected loader"),
        }?;

        assert_eq!(http_loader.location, ((1, 15), (4, 2)).into());

        let http_attributes = http_loader
            .clone()
            .attributes
            .ok_or("Unexpected missing attributes")?;

        assert_eq!(http_attributes.location, ((1, 20), (4, 2)).into());

        let (http_attribute_method_location, http_method) = match http_attributes.attributes[0] {
            syntax::HttpLoaderAttribute::Method(location, method) => Ok((location, method)),
            _ => Err("Unexpected attribute"),
        }?;

        assert_eq!(http_attribute_method_location, ((2, 5), (2, 17)).into());

        assert_eq!(
            http_method,
            syntax::HttpMethod::Get(((2, 14), (2, 17)).into())
        );

        let (http_attribute_url_location, http_url) = match http_attributes.attributes[1] {
            syntax::HttpLoaderAttribute::Url(location, url) => Ok((location, url)),
            _ => Err("Unexpected attribute"),
        }?;

        assert_eq!(http_attribute_url_location, ((3, 5), (3, 41)).into());
        assert_eq!(http_url.location, ((3, 11), (3, 41)).into());
        assert_eq!(http_url.string, "'https://example.com/data.csv'");

        Ok(())
    }
}
