macro_rules! derive_enum_serde {
    ($name:ident, $remote:ident) => {
        #[allow(dead_code)]
        pub mod $name {
            use dashql_proto::syntax::$remote;
            use serde::{Deserializer, Serializer};

            pub fn serialize<S>(value: &$remote, ser: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                ser.serialize_i32(value.0.into())
            }

            pub fn deserialize<'de, D>(de: D) -> Result<$remote, D::Error>
            where
                D: Deserializer<'de>,
            {
                let id_unchecked: i32 = serde::de::Deserialize::deserialize(de)?;
                Ok($remote(id_unchecked as u8))
            }

            pub mod opt {
                use super::*;

                pub fn serialize<S>(value: &Option<$remote>, ser: S) -> Result<S::Ok, S::Error>
                where
                    S: Serializer,
                {
                    match value {
                        Some(v) => ser.serialize_i32(v.0.into()),
                        None => ser.serialize_i32(-1),
                    }
                }

                pub fn deserialize<'de, D>(de: D) -> Result<Option<$remote>, D::Error>
                where
                    D: Deserializer<'de>,
                {
                    let id_unchecked: i32 = serde::de::Deserialize::deserialize(de)?;
                    if id_unchecked == -1 {
                        return Ok(None);
                    }
                    Ok(Some($remote(id_unchecked as u8)))
                }
            }

            pub mod cell {
                use super::super::super::ast_cell::*;
                use super::*;

                pub fn serialize<S>(value: &ASTCell<$remote>, ser: S) -> Result<S::Ok, S::Error>
                where
                    S: Serializer,
                {
                    ser.serialize_i32(value.get().0.into())
                }

                pub fn deserialize<'de, D>(de: D) -> Result<Option<ASTCell<$remote>>, D::Error>
                where
                    D: Deserializer<'de>,
                {
                    let id_unchecked: i32 = serde::de::Deserialize::deserialize(de)?;
                    if id_unchecked == -1 {
                        return Ok(None);
                    }
                    Ok(Some(ASTCell::with_value($remote(id_unchecked as u8))))
                }
            }

            pub mod cell_opt {
                use super::super::super::ast_cell::*;
                use super::*;

                pub fn serialize<S>(value: &ASTCell<Option<$remote>>, ser: S) -> Result<S::Ok, S::Error>
                where
                    S: Serializer,
                {
                    match value.get() {
                        Some(v) => ser.serialize_i32(v.0.into()),
                        None => ser.serialize_i32(-1),
                    }
                }

                pub fn deserialize<'de, D>(de: D) -> Result<Option<ASTCell<Option<$remote>>>, D::Error>
                where
                    D: Deserializer<'de>,
                {
                    let id_unchecked: i32 = serde::de::Deserialize::deserialize(de)?;
                    if id_unchecked == -1 {
                        return Ok(None);
                    }
                    Ok(Some(ASTCell::with_value(Some($remote(id_unchecked as u8)))))
                }
            }
        }
    };
}

derive_enum_serde!(serde_character_type, CharacterType);
derive_enum_serde!(serde_column_constraint, ColumnConstraint);
derive_enum_serde!(serde_combine_modifier, CombineModifier);
derive_enum_serde!(serde_combine_operation, CombineOperation);
derive_enum_serde!(serde_const_type, AConstType);
derive_enum_serde!(serde_constraint_attribute, ConstraintAttribute);
derive_enum_serde!(serde_expression_operator, ExpressionOperator);
derive_enum_serde!(serde_extract_target, ExtractTarget);
derive_enum_serde!(serde_fetch_method_type, FetchMethodType);
derive_enum_serde!(serde_input_component_type, InputComponentType);
derive_enum_serde!(serde_interval_type, IntervalType);
derive_enum_serde!(serde_join_type, JoinType);
derive_enum_serde!(serde_key_action_command, KeyActionCommand);
derive_enum_serde!(serde_key_action_trigger, KeyActionTrigger);
derive_enum_serde!(serde_known_function, KnownFunction);
derive_enum_serde!(serde_load_method_type, LoadMethodType);
derive_enum_serde!(serde_numeric_type, NumericType);
derive_enum_serde!(serde_on_commit_option, OnCommitOption);
derive_enum_serde!(serde_order_direction, OrderDirection);
derive_enum_serde!(serde_order_null_rule, OrderNullRule);
derive_enum_serde!(serde_row_locking_block_behavior, RowLockingBlockBehavior);
derive_enum_serde!(serde_row_locking_strength, RowLockingStrength);
derive_enum_serde!(serde_sample_count_unit, SampleCountUnit);
derive_enum_serde!(serde_subquery_quantifier, SubqueryQuantifier);
derive_enum_serde!(serde_table_constraint, TableConstraint);
derive_enum_serde!(serde_temp_type, TempType);
derive_enum_serde!(serde_trim_direction, TrimDirection);
derive_enum_serde!(serde_viz_component_type, VizComponentType);
derive_enum_serde!(serde_window_bound_direction, WindowBoundDirection);
derive_enum_serde!(serde_window_bound_mode, WindowBoundMode);
derive_enum_serde!(serde_window_exclusion_mode, WindowExclusionMode);
derive_enum_serde!(serde_window_range_mode, WindowRangeMode);
