use super::ast_printing;
use quick_xml::Writer;
use std::error::Error;

fn test_grammar(text: &str, expected: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let program = crate::grammar::parse(text)?;
    let mut buffer = Vec::new();
    let mut writer = Writer::new_with_indent(&mut buffer, ' ' as u8, 4);
    let (ast, txt) = program.read();
    ast_printing::print_ast(&mut writer, ast, text)?;
    let xml_str = std::str::from_utf8(&buffer)?;
    assert_eq!(xml_str, expected.trim());
    Ok(())
}

#[test]
fn test_select_1() -> Result<(), Box<dyn Error + Send + Sync>> {
    test_grammar(
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
    )
}
