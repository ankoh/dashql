//! The names of enum node values.

use dashql_buffers::parser::*;

/// The name of the value of an enum node. Names are looked up by the value as an index (all these
/// enums are contiguous), except for the sparse JoinType. Enums that are not listed here are named "?".
pub fn enum_text(node: &Node) -> &'static str {
    let v = node.children_begin_or_value() as usize;
    macro_rules! by_index {
        ($t:ident) => {
            $t::ENUM_VALUES.get(v).and_then(|e| e.variant_name()).unwrap_or("?")
        };
    }
    match node.node_type() {
        NodeType::ENUM_SQL_ALTER_ROLE_ACTION => by_index!(AlterRoleAction),
        NodeType::ENUM_SQL_CHARACTER_TYPE => by_index!(CharacterType),
        NodeType::ENUM_SQL_COLUMN_CONSTRAINT => by_index!(ColumnConstraint),
        NodeType::ENUM_SQL_COMBINE_MODIFIER => by_index!(CombineModifier),
        NodeType::ENUM_SQL_COMBINE_OPERATION => by_index!(CombineOperation),
        NodeType::ENUM_SQL_CONSTRAINT_ATTRIBUTE => by_index!(ConstraintAttribute),
        NodeType::ENUM_SQL_CONST_TYPE => by_index!(AConstType),
        NodeType::ENUM_SQL_COPY_DIRECTION => by_index!(CopyDirection),
        NodeType::ENUM_SQL_COPY_OPTION => by_index!(CopyOption),
        NodeType::ENUM_SQL_CURSOR_OPTION => by_index!(CursorOption),
        NodeType::ENUM_SQL_DATABASE_COPY_DIRECTION => by_index!(DatabaseCopyDirection),
        NodeType::ENUM_SQL_DATABASE_LOCALITY => by_index!(DatabaseLocality),
        NodeType::ENUM_SQL_DATABASE_OPTION => by_index!(DatabaseOption),
        NodeType::ENUM_SQL_DEFINITION_TYPE => by_index!(DefinitionType),
        NodeType::ENUM_SQL_DROP_BEHAVIOR => by_index!(DropBehavior),
        NodeType::ENUM_SQL_DROP_OBJECT_TYPE => by_index!(DropObjectType),
        NodeType::ENUM_SQL_EXPRESSION_OPERATOR => by_index!(ExpressionOperator),
        NodeType::ENUM_SQL_EXTRACT_TARGET => by_index!(ExtractTarget),
        NodeType::ENUM_SQL_FETCH_DIRECTION => by_index!(FetchDirection),
        NodeType::ENUM_SQL_FUNCTION_OPTION => by_index!(FunctionOption),
        NodeType::ENUM_SQL_FUNCTION_PARAMETER_MODE => by_index!(FunctionParameterMode),
        NodeType::ENUM_SQL_GRANT_TARGET_TYPE => by_index!(GrantTargetType),
        NodeType::ENUM_SQL_GROUP_BY_ITEM_TYPE => by_index!(GroupByItemType),
        NodeType::ENUM_SQL_INSERT_CONFLICT_ACTION => by_index!(InsertConflictAction),
        NodeType::ENUM_SQL_INTERVAL_TYPE => by_index!(IntervalType),
        NodeType::ENUM_SQL_JSON_BEHAVIOR => by_index!(JsonBehavior),
        NodeType::ENUM_SQL_JSON_WRAPPER => by_index!(JsonWrapper),
        NodeType::ENUM_SQL_KEY_ACTION_COMMAND => by_index!(KeyActionCommand),
        NodeType::ENUM_SQL_KEY_ACTION_TRIGGER => by_index!(KeyActionTrigger),
        NodeType::ENUM_SQL_KEY_MATCH => by_index!(KeyMatch),
        NodeType::ENUM_SQL_KNOWN_FUNCTION => by_index!(KnownFunction),
        NodeType::ENUM_SQL_MERGE_ACTION => by_index!(MergeAction),
        NodeType::ENUM_SQL_MERGE_MATCH => by_index!(MergeMatch),
        NodeType::ENUM_SQL_NUMERIC_TYPE => by_index!(NumericType),
        NodeType::ENUM_SQL_ON_COMMIT_OPTION => by_index!(OnCommitOption),
        NodeType::ENUM_SQL_ORDER_DIRECTION => by_index!(OrderDirection),
        NodeType::ENUM_SQL_ORDER_NULL_RULE => by_index!(OrderNullRule),
        NodeType::ENUM_SQL_PRIVILEGE => by_index!(Privilege),
        NodeType::ENUM_SQL_RENAME_OBJECT_TYPE => by_index!(RenameObjectType),
        NodeType::ENUM_SQL_ROLE_OPTION => by_index!(RoleOption),
        NodeType::ENUM_SQL_ROLE_TYPE => by_index!(RoleType),
        NodeType::ENUM_SQL_ROW_LOCKING_BLOCK_BEHAVIOR => by_index!(RowLockingBlockBehavior),
        NodeType::ENUM_SQL_ROW_LOCKING_STRENGTH => by_index!(RowLockingStrength),
        NodeType::ENUM_SQL_SAMPLE_UNIT_TYPE => by_index!(SampleCountUnit),
        NodeType::ENUM_SQL_SEQUENCE_OPTION => by_index!(SequenceOption),
        NodeType::ENUM_SQL_SESSION_PARAMETER => by_index!(SessionParameter),
        NodeType::ENUM_SQL_STREAM_TYPE => by_index!(StreamType),
        NodeType::ENUM_SQL_SUBQUERY_QUANTIFIER => by_index!(SubqueryQuantifier),
        NodeType::ENUM_SQL_TABLE_CONSTRAINT => by_index!(TableConstraint),
        NodeType::ENUM_SQL_TABLE_LIKE_OPTION => by_index!(TableLikeOption),
        NodeType::ENUM_SQL_TEMP_TYPE => by_index!(TempType),
        NodeType::ENUM_SQL_TRANSACTION_COMMAND => by_index!(TransactionCommand),
        NodeType::ENUM_SQL_TRANSACTION_ISOLATION_LEVEL => by_index!(TransactionIsolationLevel),
        NodeType::ENUM_SQL_TRIM_TARGET => by_index!(TrimDirection),
        NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION => by_index!(WindowBoundDirection),
        NodeType::ENUM_SQL_WINDOW_BOUND_MODE => by_index!(WindowBoundMode),
        NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE => by_index!(WindowExclusionMode),
        NodeType::ENUM_SQL_WINDOW_RANGE_MODE => by_index!(WindowRangeMode),
        NodeType::ENUM_SQL_ZONE_VALUE_TYPE => by_index!(ZoneValueType),
        NodeType::ENUM_SQL_JOIN_TYPE => {
            JoinType(v as u8).variant_name().filter(|_| v <= u8::MAX as usize).unwrap_or("?")
        }
        _ => "?",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::actions::{enum_node, NO_PARENT};

    #[test]
    fn names_enum_values() {
        let loc = SymbolSpan::default();
        assert_eq!(enum_text(&enum_node(loc, ExpressionOperator::AND)), "AND");
        assert_eq!(enum_text(&enum_node(loc, JoinType::OUTER_FULL)), "OUTER_FULL");
        assert_eq!(enum_text(&enum_node(loc, KeyMatch::FULL)), "FULL");
        assert_eq!(enum_text(&enum_node(loc, TableConstraint::UNIQUE)), "UNIQUE");
        assert_eq!(enum_text(&enum_node(loc, SampleCountUnit::PERCENT)), "PERCENT");
        let _ = NO_PARENT;
    }
}
