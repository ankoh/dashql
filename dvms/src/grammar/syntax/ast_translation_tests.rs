use super::ast_node::*;
use super::ast_printing::print_ast;
use super::ast_translation::translate_ast;
use super::sql_nodes::*;
use quick_xml::Writer;
use std::error::Error;
use std::io::Cursor;

fn test_translation(
    text: &str,
    ast_xml: &str,
    ast_rs: Vec<ASTNode<'static>>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let program = crate::grammar::parse(text)?;
    let mut writer = Writer::new_with_indent(Cursor::new(Vec::new()), ' ' as u8, 4);
    print_ast(&mut writer, text, program.read())?;
    let xml_buffer = writer.into_inner().into_inner();
    let xml_str = std::str::from_utf8(&xml_buffer)?;
    assert_eq!(xml_str, ast_xml.trim());

    let translated = translate_ast(text, program.read())?;
    assert_eq!(&format!("{:#?}", &translated), &format!("{:#?}", &ast_rs));
    Ok(())
}

#[test]
fn test_select_1() -> Result<(), Box<dyn Error + Send + Sync>> {
    test_translation(
        "select 1;",
        r#"
<statements>
    <statement type="SELECT">
        <node type="OBJECT_SQL_SELECT" loc="0..8" text="select 1">
            <node key="SQL_SELECT_TARGETS" type="ARRAY">
                <node type="OBJECT_SQL_RESULT_TARGET" loc="7..8" text="1">
                    <node key="SQL_RESULT_TARGET_VALUE" type="STRING_REF" loc="7..8" text="1"/>
                </node>
            </node>
        </node>
    </statement>
</statements>"#,
        vec![ASTNode::SelectStatement(SelectStatement {
            targets: vec![ResultTarget::Value {
                value: Box::new(Expression::StringRef("1")),
                alias: None,
            }],
            ..Default::default()
        })],
    )
}
