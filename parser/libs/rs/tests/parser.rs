use dashql_parser::{ParseResult, Parser};

#[test]
fn test_parse_empty() {
    let input = "";

    let ParseResult { module, .. } = Parser::parse(input);

    let statements = module.statements().unwrap();
    let errors = module.errors().unwrap();
    let line_breaks = module.line_breaks().unwrap();
    let comments = module.comments().unwrap();

    assert_eq!(statements.entries().unwrap().len(), 0);
    assert_eq!(errors.len(), 0);
    assert_eq!(line_breaks, []);
    assert_eq!(comments, []);
}
