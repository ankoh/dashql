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
        assert_eq!(location, ((0, 0), (0, 0)).into());

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

        let http_attributes = match &http_loader.attributes {
            Some(attributes) => Ok(attributes),
            None => Err("Unexpected missing attributes"),
        }?;

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

        let http_attributes = match &http_loader.attributes {
            Some(attributes) => Ok(attributes),
            None => Err("Unexpected missing attributes"),
        }?;

        assert_eq!(http_attributes.location, ((1, 20), (4, 2)).into());
        assert_eq!(http_attributes.attributes.len(), 2);

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

    #[test]
    fn parse_extract_statement_csv_extractor() -> Result<(), Box<dyn std::error::Error>> {
        let input = "EXTRACT foo FROM bar USING CSV;";

        let lexerdef = lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = parser::parse(&lexer);
        let (result, _) = result.ok_or("Unexpected missing result")??;

        assert_eq!(errors.len(), 0);
        assert_eq!(result.len(), 1);

        let extract_statement = match &result[0] {
            syntax::Statement::ExtractStatement(statement) => Ok(statement),
            _ => Err("Unexpected statement"),
        }?;

        assert_eq!(extract_statement.location, ((1, 1), (1, 32)).into());
        assert_eq!(
            extract_statement.identifier.location,
            ((1, 9), (1, 12)).into()
        );
        assert_eq!(extract_statement.identifier.string, "foo");
        assert_eq!(extract_statement.source.location, ((1, 18), (1, 21)).into());
        assert_eq!(extract_statement.source.string, "bar");

        let csv_extractor = match &extract_statement.method {
            syntax::ExtractMethod::Csv(extractor) => Ok(extractor),
            #[allow(unreachable_patterns)]
            _ => Err("Unexpected extractor"),
        }?;

        assert_eq!(csv_extractor.location, ((1, 28), (1, 31)).into());
        assert_eq!(csv_extractor.attributes, None);

        Ok(())
    }

    #[test]
    fn parse_extract_statement_csv_extractor_with_attributes_empty(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let input = "EXTRACT foo FROM bar USING CSV ();";

        let lexerdef = lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = parser::parse(&lexer);
        let (result, _) = result.ok_or("Unexpected missing result")??;

        assert_eq!(errors.len(), 0);
        assert_eq!(result.len(), 1);

        let extract_statement = match &result[0] {
            syntax::Statement::ExtractStatement(statement) => Ok(statement),
            _ => Err("Unexpected statement"),
        }?;

        assert_eq!(extract_statement.location, ((1, 1), (1, 35)).into());
        assert_eq!(
            extract_statement.identifier.location,
            ((1, 9), (1, 12)).into()
        );
        assert_eq!(extract_statement.identifier.string, "foo");
        assert_eq!(extract_statement.source.location, ((1, 18), (1, 21)).into());
        assert_eq!(extract_statement.source.string, "bar");

        let csv_extractor = match &extract_statement.method {
            syntax::ExtractMethod::Csv(extractor) => Ok(extractor),
            #[allow(unreachable_patterns)]
            _ => Err("Unexpected extractor"),
        }?;

        assert_eq!(csv_extractor.location, ((1, 28), (1, 34)).into());

        let csv_attributes = match &csv_extractor.attributes {
            Some(attributes) => Ok(attributes),
            None => Err("Unexpected missing attributes"),
        }?;

        assert_eq!(csv_attributes.location, ((1, 32), (1, 34)).into());
        assert_eq!(csv_attributes.attributes, vec![]);

        Ok(())
    }

    #[test]
    fn parse_extract_statement_csv_extractor_with_attributes(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let input = indoc! {r#"
            EXTRACT foo FROM bar USING CSV (
                ENCODING = 'UTF-8',
                HEADER = true,
                HEADER = (),
                HEADER = ('foo', 'bar'),
                DELIMITER = '\t',
                QUOTE = '\'',
                DATE FORMAT = '%Y-%m-%d',
                TIMESTAMP FORMAT = '%Y-%m-%d %H:%M:%S'
            );
        "#};

        let lexerdef = lexer::lexerdef();
        let lexer = lexerdef.lexer(&input);

        let (result, errors) = parser::parse(&lexer);
        let (result, _) = result.ok_or("Unexpected missing result")??;

        assert_eq!(errors.len(), 0);
        assert_eq!(result.len(), 1);

        let extract_statement = match &result[0] {
            syntax::Statement::ExtractStatement(statement) => Ok(statement),
            _ => Err("Unexpected statement"),
        }?;

        assert_eq!(extract_statement.location, ((1, 1), (10, 3)).into());
        assert_eq!(
            extract_statement.identifier.location,
            ((1, 9), (1, 12)).into()
        );
        assert_eq!(extract_statement.identifier.string, "foo");
        assert_eq!(extract_statement.source.location, ((1, 18), (1, 21)).into());
        assert_eq!(extract_statement.source.string, "bar");

        let csv_extractor = match &extract_statement.method {
            syntax::ExtractMethod::Csv(extractor) => Ok(extractor),
            #[allow(unreachable_patterns)]
            _ => Err("Unexpected extractor"),
        }?;

        assert_eq!(csv_extractor.location, ((1, 28), (10, 2)).into());

        let csv_attributes = match &csv_extractor.attributes {
            Some(attributes) => Ok(attributes),
            None => Err("Unexpected missing attributes"),
        }?;

        assert_eq!(csv_attributes.location, ((1, 32), (10, 2)).into());
        assert_eq!(csv_attributes.attributes.len(), 8);

        let (csv_encoding_attribute_location, csv_encoding) = match &csv_attributes.attributes[0] {
            syntax::CsvExtractorAttribute::Encoding(location, encoding) => Ok((location, encoding)),
            _ => Err("Unexpected attribute"),
        }?;

        assert_eq!(csv_encoding_attribute_location, &((2, 5), (2, 23)).into());
        assert_eq!(csv_encoding.location, ((2, 16), (2, 23)).into());
        assert_eq!(csv_encoding.string, "'UTF-8'");

        let (csv_header_attribute_location, csv_header) = match &csv_attributes.attributes[1] {
            syntax::CsvExtractorAttribute::Header(location, header) => Ok((location, header)),
            _ => Err("Unexpected attribute"),
        }?;

        assert_eq!(csv_header_attribute_location, &((3, 5), (3, 18)).into());

        let csv_header_value = match &csv_header {
            syntax::CsvHeaderValue::Boolean(value) => Ok(value),
            _ => Err("Unexpected value"),
        }?;

        assert_eq!(csv_header_value.location, ((3, 14), (3, 18)).into());
        assert_eq!(csv_header_value.boolean, true);

        let (csv_header_attribute_location, csv_header) = match &csv_attributes.attributes[2] {
            syntax::CsvExtractorAttribute::Header(location, header) => Ok((location, header)),
            _ => Err("Unexpected attribute"),
        }?;

        assert_eq!(csv_header_attribute_location, &((4, 5), (4, 16)).into());

        let csv_header_value = match &csv_header {
            syntax::CsvHeaderValue::Strings(value) => Ok(value),
            _ => Err("Unexpected value"),
        }?;

        assert_eq!(csv_header_value.location, ((4, 14), (4, 16)).into());
        assert_eq!(csv_header_value.strings, vec![]);

        let (csv_header_attribute_location, csv_header) = match &csv_attributes.attributes[3] {
            syntax::CsvExtractorAttribute::Header(location, header) => Ok((location, header)),
            _ => Err("Unexpected attribute"),
        }?;

        assert_eq!(csv_header_attribute_location, &((5, 5), (5, 28)).into());

        let csv_header_value = match &csv_header {
            syntax::CsvHeaderValue::Strings(value) => Ok(value),
            _ => Err("Unexpected value"),
        }?;

        assert_eq!(csv_header_value.location, ((5, 14), (5, 28)).into());
        assert_eq!(csv_header_value.strings.len(), 2);
        assert_eq!(
            csv_header_value.strings[0].location,
            ((5, 15), (5, 20)).into()
        );
        assert_eq!(csv_header_value.strings[0].string, "'foo'");
        assert_eq!(
            csv_header_value.strings[1].location,
            ((5, 22), (5, 27)).into()
        );
        assert_eq!(csv_header_value.strings[1].string, "'bar'");

        let (csv_delimiter_attribute_location, csv_delimiter) = match &csv_attributes.attributes[4]
        {
            syntax::CsvExtractorAttribute::Delimiter(location, delimiter) => {
                Ok((location, delimiter))
            }
            _ => Err("Unexpected attribute"),
        }?;

        assert_eq!(csv_delimiter_attribute_location, &((6, 5), (6, 21)).into());
        assert_eq!(csv_delimiter.location, ((6, 17), (6, 21)).into());
        assert_eq!(csv_delimiter.string, r#"'\t'"#);

        let (csv_quote_attribute_location, csv_quote) = match &csv_attributes.attributes[5] {
            syntax::CsvExtractorAttribute::Quote(location, quote) => Ok((location, quote)),
            _ => Err("Unexpected attribute"),
        }?;

        assert_eq!(csv_quote_attribute_location, &((7, 5), (7, 17)).into());
        assert_eq!(csv_quote.location, ((7, 13), (7, 17)).into());
        assert_eq!(csv_quote.string, r#"'\''"#);

        let (csv_date_format_attribute_location, csv_date_format) =
            match &csv_attributes.attributes[6] {
                syntax::CsvExtractorAttribute::DateFormat(location, date_format) => {
                    Ok((location, date_format))
                }
                _ => Err("Unexpected attribute"),
            }?;

        assert_eq!(
            csv_date_format_attribute_location,
            &((8, 5), (8, 29)).into()
        );
        assert_eq!(csv_date_format.location, ((8, 19), (8, 29)).into());
        assert_eq!(csv_date_format.string, "'%Y-%m-%d'");

        let (csv_timestamp_format_attribute_location, csv_timestamp_format) =
            match &csv_attributes.attributes[7] {
                syntax::CsvExtractorAttribute::TimestampFormat(location, timestamp_format) => {
                    Ok((location, timestamp_format))
                }
                _ => Err("Unexpected attribute"),
            }?;

        assert_eq!(
            csv_timestamp_format_attribute_location,
            &((9, 5), (9, 43)).into()
        );
        assert_eq!(csv_timestamp_format.location, ((9, 24), (9, 43)).into());
        assert_eq!(csv_timestamp_format.string, "'%Y-%m-%d %H:%M:%S'");

        Ok(())
    }
}
