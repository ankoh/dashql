use super::node::*;
use super::sql_nodes::*;
use crate::proto::syntax as sx;
use quick_xml::events::Event;
use quick_xml::events::BytesEnd;
use quick_xml::events::attributes::Attribute;
use quick_xml::events::BytesStart;
use quick_xml::Writer;
use std::io::Cursor;
use sx::AttributeKey as Key;

const INLINE_LOCATION_CAP: usize = 20;
const LOCATION_HINT_LENGTH: usize = 10;

fn encode_location<'writer, 'text>(writer: &mut BytesStart<'writer>, loc: sx::Location, text: &'text str) {
    let begin = loc.offset() as usize;
    let end = (loc.offset() + loc.length()) as usize;
    let loc_attr = ("loc", format!("{b}..{e}", b = begin, e = end).as_str());
    if (loc.length() as usize) < INLINE_LOCATION_CAP {
        writer.extend_attributes([loc_attr, ("text", &text[begin..end])]);
    } else {
        let prefix = &text[begin..(begin + LOCATION_HINT_LENGTH)];
        let suffix = &text[(end - LOCATION_HINT_LENGTH)..end];
        let text = format!("{p}..{s}", p=prefix, s=suffix);
        writer.extend_attributes([loc_attr, ("text", text.as_str())]);
}

fn encode_error<'writer, 'text, 'ast>(writer: &mut BytesStart<'writer>, error: sx::Error<'ast>, text: &'text str) {
    writer.extend_attributes([("message", error.message().unwrap_or_default())]);
    encode_location(writer, error.location().copied().unwrap_or_default(), text);
}

pub fn print_ast<'text, 'ast, W>(writer: &mut Writer<W>, text: &'text str, ast: sx::Program<'ast>)
    where W: std::io::Write {
    let nodes = ast.nodes().unwrap_or_default();
    let mut writer = Writer::new(Cursor::new(Vec::new()));

    let mut stmts = BytesStart::borrowed_name(b"statements");
    for s in ast.statements().unwrap_or_default().iter() {
        let mut stmt = BytesStart::borrowed_name(b"statement");
        stmt.push_attribute(("type", s.statement_type().variant_name().unwrap_or_default()));
        writer.write_event(Event::Start(stmt));

        // Do a post-order DFS traversal
        let mut pending = Vec::new();
        pending.push((false, s.root_node()));
        while !pending.is_empty() {
            let (visited, node_id) = pending.last().copied().unwrap();
            let mut node = nodes[node_id as usize];

            if !visited {
                pending.last_mut().unwrap().0 = true;
                let mut el = BytesStart::borrowed_name(b"node");
                match node.node_type() {
                    sx::NodeType::NONE => {}
                    sx::NodeType::BOOL => {
                        el.push_attribute(("value", format!("{}", node.children_begin_or_value() != 0).as_str()));
                    }
                    sx::NodeType::UI32_BITMAP | sx::NodeType::UI32 => {
                        el.push_attribute(("value", format!("{}", node.children_begin_or_value()).as_str()));
                    }
                    sx::NodeType::STRING_REF => {
                        encode_location(&mut el, *node.location(), text);
                    }
                    sx::NodeType::ARRAY => {
                        let begin = node.children_begin_or_value();
                        for i in begin..(begin + node.children_count()) {
                            pending.push((false, i));
                        }
                        break;
                    }
                    _ => {
                        let node_type_id = node.node_type();
                        if node_type_id.0 > sx::NodeType::OBJECT_KEYS_.0 {

                        } else if node_type_id.0 > sx::NodeType::ENUM_KEYS_.0 {
                            el.push_attribute(("value", format!("{}", node.children_begin_or_value()).as_str()))
                        } else {
                            el.push_attribute(("value", format!("{}", node.children_begin_or_value()).as_str()))
                        }
                    }
                }
            }
        }

        writer.write_event(Event::End(BytesEnd::borrowed(b"statement")));
    }
}
