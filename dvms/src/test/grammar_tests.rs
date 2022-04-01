use crate::grammar;

#[test]
fn test_parser_call() {
    grammar::parse("select 1;");
}
