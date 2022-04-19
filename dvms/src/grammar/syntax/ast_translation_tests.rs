use super::ast_translation::translate_ast;
use super::sql_nodes::*;
use super::statement::Statement;
use std::error::Error;

fn test_translation(
    text: &str,
    expected: Vec<Statement<'static>>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let program = crate::grammar::parse(text)?;

    let translated = translate_ast(text, program.read())?;
    assert_eq!(&format!("{:#?}", &translated), &format!("{:#?}", &expected));
    Ok(())
}

#[test]
fn test_select_1() -> Result<(), Box<dyn Error + Send + Sync>> {
    test_translation(
        "select 1;",
        vec![Statement::Select(SelectStatement {
            targets: vec![ResultTarget::Value {
                value: Box::new(Expression::StringRef("1")),
                alias: None,
            }],
            ..Default::default()
        })],
    )
}
