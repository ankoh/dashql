//! The tests of the core, one module per file. The snapshot tests, the round trip of the formatter and the Hyper
//! validation have binaries of their own.

mod analyzer_declaration_test;
mod analyzer_delete_test;
mod analyzer_insert_test;
mod analyzer_name_resolution_test;
mod batch_test;
mod buffers_enums;
mod catalog_descriptor_test;
mod catalog_test;
mod compiler_test;
mod completion_test;
mod cursor_test;
mod error_test;
mod hash_test;
mod name_tagging_test;
mod nesting_test;
mod pack_test;
mod script_session_test;
mod script_test;
mod sql_types_test;
mod string_conversion_test;
mod table_parameters_test;
mod topk_test;
mod touched_relations_test;
mod unification_test;
