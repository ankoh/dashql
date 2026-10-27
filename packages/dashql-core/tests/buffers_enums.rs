//! The FlatBuffers enums are the in-memory representation of the AST, and the core relies on their
//! exact numbering: ordinal range checks on `NodeType`, `LITERAL_* - 5 == LiteralType`, the
//! catalog object types doubling as completion candidate types, and `Script::compute_signature`
//! hashing raw enum values into a cache key. These tests pin the invariants so that a schema edit
//! that breaks them fails loudly.

use dashql_buffers::algebra::LiteralType;
use dashql_buffers::completion::CompletionCandidateObjectType;
use dashql_buffers::parser::{AttributeKey, Node, NodeType, SymbolSpan};

#[test]
fn node_type_markers() {
    assert_eq!(NodeType::ENUM_KEYS_.0, 10);
    assert_eq!(NodeType::OBJECT_KEYS_.0, 41);
}

#[test]
fn node_type_ranges() {
    // The core classifies node types by ordinal ranges, the names must agree with them.
    for &node_type in NodeType::ENUM_VALUES {
        let name = node_type.variant_name().unwrap();
        let v = node_type.0;
        if v < NodeType::ENUM_KEYS_.0 {
            assert!(!name.starts_with("ENUM_") && !name.starts_with("OBJECT_"), "{name}");
        } else if v > NodeType::ENUM_KEYS_.0 && v < NodeType::OBJECT_KEYS_.0 {
            assert!(name.starts_with("ENUM_SQL_"), "{name}");
        } else if v > NodeType::OBJECT_KEYS_.0 {
            assert!(name.starts_with("OBJECT_"), "{name}");
        }
    }
}

#[test]
fn literal_types() {
    let literal_type = |t: NodeType| LiteralType(t.0 as u8 - 5);
    assert_eq!(literal_type(NodeType::LITERAL_NULL), LiteralType::NULL_);
    assert_eq!(literal_type(NodeType::LITERAL_INTEGER), LiteralType::INTEGER);
    assert_eq!(literal_type(NodeType::LITERAL_FLOAT), LiteralType::FLOAT);
    assert_eq!(literal_type(NodeType::LITERAL_STRING), LiteralType::STRING);
    assert_eq!(literal_type(NodeType::LITERAL_INTERVAL), LiteralType::INTERVAL);
}

#[test]
fn completion_candidate_object_types() {
    // Must match `CatalogObjectType` in dashql_core::catalog.
    assert_eq!(CompletionCandidateObjectType::DATABASE.0, 1);
    assert_eq!(CompletionCandidateObjectType::SCHEMA.0, 2);
    assert_eq!(CompletionCandidateObjectType::TABLE.0, 3);
    assert_eq!(CompletionCandidateObjectType::COLUMN.0, 4);
    assert_eq!(CompletionCandidateObjectType::FUNCTION.0, 5);
}

#[test]
fn node_layout() {
    assert_eq!(std::mem::size_of::<Node>(), 24);
    let node = Node::new(&SymbolSpan::new(3, 2), NodeType::OBJECT_SQL_SELECT, AttributeKey::NONE, 7, 11, 13);
    assert_eq!(node.symbol_span().offset(), 3);
    assert_eq!(node.symbol_span().length(), 2);
    assert_eq!(node.node_type(), NodeType::OBJECT_SQL_SELECT);
    assert_eq!(node.attribute_key(), AttributeKey::NONE);
    assert_eq!(node.parent(), 7);
    assert_eq!(node.children_begin_or_value(), 11);
    assert_eq!(node.children_count(), 13);
}
