#include "dashql/analyzer/analyzer.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"
#include "gtest/gtest.h"

using namespace dashql;

namespace {

/// Helper template for static_assert in generic visitor
template <typename T> constexpr bool always_false = false;

struct ExpectedScriptCursor {
    std::optional<std::string_view> scanner_token_text;
    std::optional<uint32_t> statement_id;
    buffers::parser::AttributeKey ast_attribute_key;
    buffers::parser::NodeType ast_node_type;
    std::optional<std::string_view> table_ref_name;
    std::optional<std::string_view> column_ref_name;
    std::vector<std::string> graph_from;
    std::vector<std::string> graph_to;
};

std::string print_name(const Script& script, const AnalyzedScript::QualifiedTableName& name) {
    auto& scanned = script.scanned_script;
    std::stringstream out;
    size_t out_idx = 0;
    auto write = [&](std::string_view name) {
        if (!name.empty()) {
            if (out_idx++ > 0) {
                out << ".";
            }
            out << name;
        }
    };
    write(name.database_name.get());
    write(name.schema_name.get());
    write(name.table_name.get());
    return out.str();
}

std::string print_name(const Script& script, const AnalyzedScript::QualifiedColumnName& name) {
    auto& scanned = script.scanned_script;
    std::stringstream out;
    size_t out_idx = 0;
    auto write = [&](std::string_view name) {
        if (!name.empty()) {
            if (out_idx++ > 0) {
                out << ".";
            }
            out << name;
        }
    };
    write(name.table_alias ? name.table_alias->get().text : "");
    write(name.column_name.get());
    return out.str();
}

void test(Script& script, size_t text_offset, ExpectedScriptCursor expected) {
    SCOPED_TRACE(std::string{"CURSOR "} + std::to_string(text_offset));
    auto [cursor, status] = script.MoveCursor(text_offset);
    ASSERT_EQ(status, buffers::status::StatusCode::OK);
    // Check scanner token
    if (expected.scanner_token_text.has_value()) {
        ASSERT_TRUE(cursor->scanner_location.has_value());
        auto token = script.scanned_script->GetSymbols()[cursor->scanner_location->current.symbol_id];
        auto token_text = script.scanned_script->ReadTextAtLocation(token.location);
        ASSERT_EQ(token_text, *expected.scanner_token_text);
    } else {
        ASSERT_FALSE(cursor->scanner_location.has_value());
    }
    // Check statement id
    ASSERT_EQ(cursor->statement_id, expected.statement_id);
    // Check AST node type
    auto& ast_node = script.analyzed_script->parsed_script->nodes[*cursor->ast_node_id];
    ASSERT_EQ(ast_node.attribute_key(), expected.ast_attribute_key)
        << buffers::parser::EnumNameAttributeKey(ast_node.attribute_key());
    ASSERT_EQ(ast_node.node_type(), expected.ast_node_type) << buffers::parser::EnumNameNodeType(ast_node.node_type());
    // Check table reference
    if (expected.table_ref_name.has_value()) {
        ASSERT_TRUE(std::holds_alternative<ScriptCursor::TableRefContext>(cursor->context));
        auto& ctx = std::get<ScriptCursor::TableRefContext>(cursor->context);
        ASSERT_LT(ctx.table_reference_id, script.analyzed_script->table_references.GetSize());
        auto& table_ref = script.analyzed_script->table_references[ctx.table_reference_id];
        std::visit(
            [&](const auto& value) {
                using T = std::decay_t<decltype(value)>;

                if constexpr (std::is_same_v<T, std::monostate>) {
                    FAIL();
                } else if constexpr (std::is_same_v<T, AnalyzedScript::TableReference::RelationExpression>) {
                    auto& rel_expr = value;
                    if (!rel_expr.resolved_table.has_value()) {
                        auto table_name = print_name(script, rel_expr.table_name);
                        ASSERT_EQ(table_name, expected.table_ref_name);
                    } else {
                        auto& resolved = rel_expr.resolved_table.value();
                        auto table_name = print_name(script, resolved.table_name);
                        ASSERT_EQ(table_name, expected.table_ref_name);
                    }
                } else {
                    static_assert(always_false<T>, "Unhandled table reference type in cursor test");
                }
            },
            table_ref.inner);

    } else {
        ASSERT_FALSE(std::holds_alternative<ScriptCursor::TableRefContext>(cursor->context));
    }
    // Check expression
    if (expected.column_ref_name.has_value()) {
        ASSERT_TRUE(std::holds_alternative<ScriptCursor::ColumnRefContext>(cursor->context));
        auto& ctx = std::get<ScriptCursor::ColumnRefContext>(cursor->context);
        ASSERT_LT(ctx.expression_id, script.analyzed_script->expressions.GetSize());
        auto& column_ref = script.analyzed_script->expressions[ctx.expression_id];
        switch (column_ref.inner.index()) {
            case 0:
                FAIL();
            case 1: {
                auto& col_ref = std::get<AnalyzedScript::Expression::ColumnRef>(column_ref.inner);
                auto table_name = print_name(script, col_ref.column_name);
                ASSERT_EQ(table_name, expected.column_ref_name);
                break;
            }
        }
    } else {
        ASSERT_FALSE(std::holds_alternative<ScriptCursor::ColumnRefContext>(cursor->context));
    }
}

TEST(CursorTest, SimpleNoExternal) {
    Catalog catalog;
    Script script{catalog, 1};
    script.InsertTextAt(0, "select * from A b, C d where b.x = d.y");
    ASSERT_EQ(script.Scan(), buffers::status::StatusCode::OK);
    ASSERT_EQ(script.Parse(), buffers::status::StatusCode::OK);
    ASSERT_EQ(script.Analyze(), buffers::status::StatusCode::OK);

    test(script, 0,
         {
             .scanner_token_text = "select",
             .statement_id = 0,
             .ast_attribute_key = buffers::parser::AttributeKey::NONE,
             .ast_node_type = buffers::parser::NodeType::OBJECT_SQL_SELECT,
         });
    test(script, 9,
         {
             .scanner_token_text = "from",
             .statement_id = 0,
             .ast_attribute_key = buffers::parser::AttributeKey::SQL_SELECT_FROM,
             .ast_node_type = buffers::parser::NodeType::ARRAY,
         });
    test(script, 14,
         {
             .scanner_token_text = "A",
             .statement_id = 0,
             .ast_attribute_key = buffers::parser::AttributeKey::NONE,
             .ast_node_type = buffers::parser::NodeType::NAME,
             .table_ref_name = "a",
         });
    test(script, 16,
         {
             .scanner_token_text = "b",
             .statement_id = 0,
             .ast_attribute_key = buffers::parser::AttributeKey::SQL_TABLEREF_ALIAS,
             .ast_node_type = buffers::parser::NodeType::NAME,
             .table_ref_name = "a",
         });
    test(script, 23,
         {
             .scanner_token_text = "where",
             .statement_id = 0,
             .ast_attribute_key = buffers::parser::AttributeKey::NONE,
             .ast_node_type = buffers::parser::NodeType::OBJECT_SQL_SELECT,
         });
    test(script, 29,
         {
             .scanner_token_text = "b",
             .statement_id = 0,
             .ast_attribute_key = buffers::parser::AttributeKey::NONE,
             .ast_node_type = buffers::parser::NodeType::NAME,
             .column_ref_name = "b.x",
             .graph_from = {"b.x"},
             .graph_to = {"d.y"},
         });
    test(script, 30,
         {
             .scanner_token_text = ".",
             .statement_id = 0,
             .ast_attribute_key = buffers::parser::AttributeKey::NONE,
             .ast_node_type = buffers::parser::NodeType::NAME,
             .column_ref_name = "b.x",
             .graph_from = {"b.x"},
             .graph_to = {"d.y"},
         });
    test(script, 31,
         {
             .scanner_token_text = "x",
             .statement_id = 0,
             .ast_attribute_key = buffers::parser::AttributeKey::NONE,
             .ast_node_type = buffers::parser::NodeType::NAME,
             .column_ref_name = "b.x",
             .graph_from = {"b.x"},
             .graph_to = {"d.y"},
         });
    test(script, 33,
         {
             .scanner_token_text = "=",
             .statement_id = 0,
             .ast_attribute_key = buffers::parser::AttributeKey::SQL_EXPRESSION_ARGS,
             .ast_node_type = buffers::parser::NodeType::ARRAY,
             .graph_from = {"b.x"},
             .graph_to = {"d.y"},
         });
}

TEST(CursorTest, TableRef) {
    Catalog catalog;
    Script script{catalog, 1};
    script.InsertTextAt(0, "select r_regionkey from region, n");
    ASSERT_EQ(script.Scan(), buffers::status::StatusCode::OK);
    ASSERT_EQ(script.Parse(), buffers::status::StatusCode::OK);
    ASSERT_EQ(script.Analyze(), buffers::status::StatusCode::OK);

    test(script, 32,
         {
             .scanner_token_text = "n",
             .statement_id = 0,
             .ast_attribute_key = buffers::parser::AttributeKey::NONE,
             .ast_node_type = buffers::parser::NodeType::NAME,
             .table_ref_name = "n",
         });
}

}  // namespace
