//! Script signatures, the persisted cache keys of compiled queries.
//!
//! The signature hashes the statement types and, per statement, the node types, attribute keys,
//! names and literal texts in node order. Signatures are persisted, so bump
//! `SCRIPT_SIGNATURE_VERSION` when the encoding changes.

use crate::error::{Error, Result};
use dashql_buffers::parser::{Node, NodeType};
use dashql_buffers::status::StatusCode;
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::parser::ParsedScript;

/// The version of the signature encoding
const SCRIPT_SIGNATURE_VERSION: u8 = 2;

fn is_enum_node(node_type: NodeType) -> bool {
    let id = node_type.0;
    id > NodeType::ENUM_KEYS_.0 && id < NodeType::OBJECT_KEYS_.0
}

fn append_text(out: &mut Vec<u8>, text: &[u8]) {
    out.extend_from_slice(&(text.len() as u64).to_le_bytes());
    out.extend_from_slice(text);
}

fn append_node(parsed: &ParsedScript, node: &Node, out: &mut Vec<u8>) {
    let node_type = node.node_type();
    out.extend_from_slice(&node_type.0.to_le_bytes());
    out.extend_from_slice(&node.attribute_key().0.to_le_bytes());
    match node_type {
        NodeType::NONE | NodeType::LITERAL_NULL => {}
        NodeType::BOOL => out.push((node.children_begin_or_value() != 0) as u8),
        NodeType::NAME => append_text(out, parsed.scanned.names.get(node.children_begin_or_value()).text.as_bytes()),
        NodeType::OPERATOR
        | NodeType::LITERAL_INTEGER
        | NodeType::LITERAL_FLOAT
        | NodeType::LITERAL_STRING
        | NodeType::LITERAL_INTERVAL => {
            let scanned = &parsed.scanned;
            let span = resolve_text_span(&scanned.text, &scanned.symbols, *node.symbol_span());
            let bytes = scanned.text.as_bytes();
            let begin = (span.offset as usize).min(bytes.len());
            let end = (begin + span.length as usize).min(bytes.len());
            append_text(out, &bytes[begin..end]);
        }
        NodeType::ARRAY => out.extend_from_slice(&(node.children_count()).to_le_bytes()),
        _ if is_enum_node(node_type) => out.extend_from_slice(&node.children_begin_or_value().to_le_bytes()),
        _ => out.extend_from_slice(&(node.children_count()).to_le_bytes()),
    }
}

/// Two FNV-1a style 64 bit hashes over the bytes
fn hash(bytes: &[u8]) -> [u64; 2] {
    let mut digest = [14695981039346656037u64, 7809847782465536322u64];
    for &b in bytes {
        digest[0] = (digest[0] ^ b as u64).wrapping_mul(1099511628211);
        digest[1] = (digest[1] ^ b.wrapping_add(0x9d) as u64).wrapping_mul(1099511628211);
    }
    digest
}

/// Compute the signature of a parsed script. Fails for scripts with scanner or parser errors.
pub fn compute_signature(parsed: &ParsedScript) -> Result<String> {
    if !parsed.scanned.errors.is_empty() || !parsed.errors.is_empty() {
        return Err(Error::status(StatusCode::SCRIPT_NOT_PARSED));
    }
    let mut script_bytes = Vec::new();
    script_bytes.extend_from_slice(b"DQLSIG");
    script_bytes.push(SCRIPT_SIGNATURE_VERSION);
    script_bytes.extend_from_slice(&(parsed.statements.len() as u32).to_le_bytes());
    let mut statement_bytes = Vec::new();
    for statement in &parsed.statements {
        statement_bytes.clear();
        let begin = statement.nodes_begin as usize;
        for node in &parsed.nodes[begin..begin + statement.node_count as usize] {
            append_node(parsed, node, &mut statement_bytes);
        }
        let digest = hash(&statement_bytes);
        script_bytes.push(statement.statement_type.0);
        script_bytes.extend_from_slice(&digest[0].to_le_bytes());
        script_bytes.extend_from_slice(&digest[1].to_le_bytes());
    }
    let digest = hash(&script_bytes);
    Ok(format!("{:016x}{:016x}", digest[0], digest[1]))
}
