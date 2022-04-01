use crate::parser;

#[test]
fn test_parser_call() {
    parser::parse("select 1;");
}
