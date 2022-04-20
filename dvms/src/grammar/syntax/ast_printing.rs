use crate::grammar::syntax::enums::get_enum_text;
use dashql_proto::syntax as sx;
use quick_xml::events::BytesEnd;
use quick_xml::events::BytesStart;
use quick_xml::events::Event;
use quick_xml::Writer;
use std::error::Error;
use sx::AttributeKey as Key;

const INLINE_LOCATION_CAP: usize = 20;
const LOCATION_HINT_LENGTH: usize = 10;

fn encode_location<'writer, 'text>(
    writer: &mut BytesStart<'writer>,
    loc: sx::Location,
    text: &'text str,
) {
    let begin = loc.offset() as usize;
    let end = (loc.offset() + loc.length()) as usize;
    if begin >= text.len() || end > text.len() {
        return;
    }
    let loc_string = format!("{b}..{e}", b = begin, e = end);
    let loc_attr = ("loc", loc_string.as_str());
    let mut out: String;
    if (loc.length() as usize) < INLINE_LOCATION_CAP {
        out = text[begin..end].to_string();
    } else {
        let prefix = &text[begin..(begin + LOCATION_HINT_LENGTH)];
        let suffix = &text[(end - LOCATION_HINT_LENGTH)..end];
        out = format!("{p}..{s}", p = prefix, s = suffix);
    }
    out = out.replace("\n", "\\n");
    writer.extend_attributes([loc_attr, ("text", &out)]);
}

fn encode_error<'writer, 'text, 'ast>(
    writer: &mut BytesStart<'writer>,
    error: sx::Error<'ast>,
    text: &'text str,
) {
    writer.extend_attributes([("message", error.message().unwrap_or_default())]);
    encode_location(writer, error.location().copied().unwrap_or_default(), text);
}

pub fn print_ast<'text, 'ast, W>(
    writer: &mut Writer<W>,
    ast: sx::Program<'ast>,
    text: &'text str,
) -> Result<(), Box<dyn Error + Send + Sync>>
where
    W: std::io::Write,
{
    let nodes = ast.nodes().unwrap_or_default();

    // Start statements
    writer.write_event(Event::Start(BytesStart::borrowed_name(b"statements")))?;
    for s in ast.statements().unwrap_or_default().iter() {
        // Start statement
        let mut stmt = BytesStart::borrowed_name(b"statement");
        stmt.push_attribute((
            "type",
            s.statement_type().variant_name().unwrap_or_default(),
        ));
        writer.write_event(Event::Start(stmt))?;

        // Do a post-order DFS traversal
        let mut pending = Vec::new();
        pending.push((false, s.root_node()));
        while !pending.is_empty() {
            let (visited, node_id) = pending.last().copied().unwrap();
            let n = nodes[node_id as usize];

            if !visited {
                pending.last_mut().unwrap().0 = true;
                let mut node = BytesStart::borrowed_name(b"node");
                if n.attribute_key() != 0 {
                    let key = Key(n.attribute_key()).variant_name().unwrap_or_default();
                    node.push_attribute(("key", key));
                }
                node.push_attribute(("type", n.node_type().variant_name().unwrap_or_default()));
                match n.node_type() {
                    sx::NodeType::NONE => {
                        pending.pop();
                    }
                    sx::NodeType::BOOL => {
                        node.push_attribute((
                            "value",
                            format!("{}", n.children_begin_or_value() != 0).as_str(),
                        ));
                        writer.write_event(Event::Empty(node))?;
                        pending.pop();
                    }
                    sx::NodeType::UI32_BITMAP | sx::NodeType::UI32 => {
                        node.push_attribute((
                            "value",
                            format!("{}", n.children_begin_or_value()).as_str(),
                        ));
                        writer.write_event(Event::Empty(node))?;
                        pending.pop();
                    }
                    sx::NodeType::STRING_REF => {
                        encode_location(&mut node, *n.location(), text);
                        writer.write_event(Event::Empty(node))?;
                        pending.pop();
                    }
                    sx::NodeType::ARRAY => {
                        let begin = n.children_begin_or_value();
                        let end = begin + n.children_count();
                        for i in 0..n.children_count() {
                            pending.push((false, end - i - 1));
                        }
                        writer.write_event(Event::Start(node))?;
                    }
                    _ => {
                        let node_type_id = n.node_type();
                        if node_type_id.0 > sx::NodeType::OBJECT_KEYS_.0 {
                            encode_location(&mut node, *n.location(), text);
                            let begin = n.children_begin_or_value();
                            let end = begin + n.children_count();
                            for i in 0..n.children_count() {
                                pending.push((false, end - i - 1));
                            }
                            writer.write_event(Event::Start(node))?;
                        } else if node_type_id.0 > sx::NodeType::ENUM_KEYS_.0 {
                            node.push_attribute(("value", get_enum_text(&n)));
                            writer.write_event(Event::Empty(node))?;
                            pending.pop();
                        } else {
                            node.push_attribute((
                                "value",
                                format!("{}", n.children_begin_or_value()).as_str(),
                            ));
                            writer.write_event(Event::Empty(node))?;
                            pending.pop();
                        }
                    }
                }
                continue;
            }
            writer.write_event(Event::End(BytesEnd::borrowed(b"node")))?;
            pending.pop();
        }
        writer.write_event(Event::End(BytesEnd::borrowed(b"statement")))?;
    }
    writer.write_event(Event::End(BytesEnd::borrowed(b"statements")))?;

    let errors = ast.errors().unwrap_or_default();
    if errors.is_empty() {
        writer.write_event(Event::Empty(BytesStart::borrowed_name(b"errors")))?;
    } else {
        writer.write_event(Event::Start(BytesStart::borrowed_name(b"errors")))?;
        for error in errors {
            let mut elem = BytesStart::borrowed_name(b"error");
            encode_error(&mut elem, error, text);
            writer.write_event(Event::Empty(elem))?;
        }
        writer.write_event(Event::End(BytesEnd::borrowed(b"errors")))?;
    }

    let line_breaks = ast.line_breaks().unwrap_or_default();
    if line_breaks.is_empty() {
        writer.write_event(Event::Empty(BytesStart::borrowed_name(b"line_breaks")))?;
    } else {
        writer.write_event(Event::Start(BytesStart::borrowed_name(b"line_breaks")))?;
        for line_break in line_breaks {
            let mut elem = BytesStart::borrowed_name(b"line_break");
            encode_location(&mut elem, *line_break, text);
            writer.write_event(Event::Empty(elem))?;
        }
        writer.write_event(Event::End(BytesEnd::borrowed(b"line_breaks")))?;
    }

    let comments = ast.comments().unwrap_or_default();
    if comments.is_empty() {
        writer.write_event(Event::Empty(BytesStart::borrowed_name(b"comments")))?;
    } else {
        writer.write_event(Event::Start(BytesStart::borrowed_name(b"comments")))?;
        for comment in comments {
            let mut elem = BytesStart::borrowed_name(b"comment");
            encode_location(&mut elem, *comment, text);
            writer.write_event(Event::Empty(elem))?;
        }
        writer.write_event(Event::End(BytesEnd::borrowed(b"comments")))?;
    }

    let dson_keys = ast.dson_keys().unwrap_or_default();
    if dson_keys.is_empty() {
        writer.write_event(Event::Empty(BytesStart::borrowed_name(b"dson_keys")))?;
    } else {
        writer.write_event(Event::Start(BytesStart::borrowed_name(b"dson_keys")))?;
        for key in dson_keys {
            let mut elem = BytesStart::borrowed_name(b"key");
            encode_location(&mut elem, *key, text);
            writer.write_event(Event::Empty(elem))?;
        }
        writer.write_event(Event::End(BytesEnd::borrowed(b"dson_keys")))?;
    }

    Ok(())
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test {
    use super::*;
    use pretty_assertions::assert_eq;
    use quick_xml::Writer;
    use std::error::Error;

    fn test_grammar(text: &str, expected: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        let program = crate::grammar::parse(text)?;
        let mut writer = Writer::new_with_indent(Vec::new(), ' ' as u8, 4);
        let (ast, _) = program.read();
        print_ast(&mut writer, ast, text)?;
        let buffer = writer.into_inner();
        let xml_str = std::str::from_utf8(&buffer).expect("invalid utf8");
        assert_eq!(expected.trim(), xml_str);
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
</statements>
<errors/>
<line_breaks/>
<comments/>
<dson_keys/>
"#,
        )
    }

    #[test]
    fn test_select_1_2() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_grammar(
            "
            select 1;
            select 2;
            ",
            r#"
<statements>
    <statement type="SELECT">
        <node type="OBJECT_SQL_SELECT" loc="13..21" text="select 1">
            <node key="SQL_SELECT_TARGETS" type="ARRAY">
                <node type="OBJECT_SQL_RESULT_TARGET" loc="20..21" text="1">
                    <node key="SQL_RESULT_TARGET_VALUE" type="STRING_REF" loc="20..21" text="1"/>
                </node>
            </node>
        </node>
    </statement>
    <statement type="SELECT">
        <node type="OBJECT_SQL_SELECT" loc="35..43" text="select 2">
            <node key="SQL_SELECT_TARGETS" type="ARRAY">
                <node type="OBJECT_SQL_RESULT_TARGET" loc="42..43" text="2">
                    <node key="SQL_RESULT_TARGET_VALUE" type="STRING_REF" loc="42..43" text="2"/>
                </node>
            </node>
        </node>
    </statement>
</statements>
<errors/>
<line_breaks>
    <line_break loc="0..1" text="\n"/>
    <line_break loc="22..23" text="\n"/>
    <line_break loc="44..45" text="\n"/>
</line_breaks>
<comments/>
<dson_keys/>
"#,
        )
    }
}
