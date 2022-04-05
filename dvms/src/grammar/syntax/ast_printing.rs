use super::node::*;
use super::sql_nodes::*;
use crate::grammar::syntax::enums::get_enum_text;
use crate::proto::syntax as sx;
use quick_xml::events::attributes::Attribute;
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
    let loc_string = format!("{b}..{e}", b = begin, e = end);
    let loc_attr = ("loc", loc_string.as_str());
    if (loc.length() as usize) < INLINE_LOCATION_CAP {
        writer.extend_attributes([loc_attr, ("text", &text[begin..end])]);
    } else {
        let prefix = &text[begin..(begin + LOCATION_HINT_LENGTH)];
        let suffix = &text[(end - LOCATION_HINT_LENGTH)..end];
        let text = format!("{p}..{s}", p = prefix, s = suffix);
        writer.extend_attributes([loc_attr, ("text", text.as_str())]);
    }
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
    text: &'text str,
    ast: sx::Program<'ast>,
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
                        for i in begin..(begin + n.children_count()) {
                            pending.push((false, i));
                        }
                        writer.write_event(Event::Start(node))?;
                    }
                    _ => {
                        let node_type_id = n.node_type();
                        if node_type_id.0 > sx::NodeType::OBJECT_KEYS_.0 {
                            node.push_attribute((
                                "type",
                                n.node_type().variant_name().unwrap_or_default(),
                            ));
                            encode_location(&mut node, *n.location(), text);
                            let begin = n.children_begin_or_value();
                            for i in begin..(begin + n.children_count()) {
                                pending.push((false, i));
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
    Ok(())
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test {
    use quick_xml::Writer;
    use std::error::Error;
    use std::io::Cursor;

    #[test]
    fn test_printing() -> Result<(), Box<dyn Error + Send + Sync>> {
        let text = "select 1;";
        let program = crate::grammar::parse(text)?;

        let mut writer = Writer::new_with_indent(Cursor::new(Vec::new()), ' ' as u8, 4);
        super::print_ast(&mut writer, text, program.read())?;

        let xml_buffer = writer.into_inner().into_inner();
        let xml_str = std::str::from_utf8(&xml_buffer)?;
        let expected = r#"<statements>
    <statement type="SELECT">
        <node type="OBJECT_SQL_SELECT" loc="0..8" text="select 1">
            <node key="SQL_SELECT_TARGETS">
                <node loc="7..8" text="1"/>
            </node>
        </node>
    </statement>
</statements>"#;
        assert_eq!(xml_str, expected);
        Ok(())
    }
}
