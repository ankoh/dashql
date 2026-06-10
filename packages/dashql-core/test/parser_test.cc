#include "dashql/parser/parser.h"

#include <optional>

#include "dashql/buffers/index_generated.h"
#include "dashql/parser/parse_context.h"
#include "dashql/parser/scanner.h"
#include "dashql/script.h"
#include "gtest/gtest.h"

using namespace dashql;
using namespace dashql::parser;

using ScannerToken = buffers::parser::ScannerTokenType;
using ParserSymbol = Parser::symbol_kind_type;

namespace {

TEST(ParserTest, FindNodeAtOffset) {
    std::shared_ptr<ParsedScript> script;

    // Helper to parse a script
    auto parse = [&](std::string_view text) {
        rope::Rope buffer{128};
        buffer.Insert(0, text);
        auto scanned = Scanner::Scan(buffer, 0, 2);
        auto parsed = Parser::Parse(scanned);
        script = std::move(parsed);
    };
    /// Test if ast node matches
    auto test_node_at_offset = [&](size_t text_offset, size_t expected_statement_id,
                                   buffers::parser::NodeType expect_node_type, sx::parser::SymbolSpan expect_loc) {
        auto result = script->FindNodeAtOffset(text_offset);
        ASSERT_TRUE(result.has_value()) << "offset=" << text_offset;
        auto [statement_id, node_id] = *result;
        ASSERT_EQ(statement_id, expected_statement_id);
        ASSERT_LT(node_id, script->nodes.size());
        auto& node = script->nodes[node_id];
        ASSERT_EQ(node.node_type(), expect_node_type);
        ASSERT_EQ(node.symbol_span().offset(), expect_loc.offset());
        ASSERT_EQ(node.symbol_span().length(), expect_loc.length());
    };

    parse("select 1");
    test_node_at_offset(0, 0, buffers::parser::NodeType::OBJECT_SQL_SELECT, sx::parser::SymbolSpan(0, 2));
    test_node_at_offset(1, 0, buffers::parser::NodeType::OBJECT_SQL_SELECT, sx::parser::SymbolSpan(0, 2));
    test_node_at_offset(2, 0, buffers::parser::NodeType::OBJECT_SQL_SELECT, sx::parser::SymbolSpan(0, 2));
    test_node_at_offset(7, 0, buffers::parser::NodeType::LITERAL_INTEGER, sx::parser::SymbolSpan(1, 1));
}

// Helper: parse a script and return the resulting ParsedScript.
static std::shared_ptr<ParsedScript> ParseString(std::string_view text) {
    rope::Rope buffer{128};
    buffer.Insert(0, text);
    auto scanned = Scanner::Scan(buffer, 0, 2);
    return Parser::Parse(scanned);
}

TEST(ParserTest, HintForStringLiteralWhereIdentExpected) {
    // FROM expects an identifier-like name. A bare SCONST should produce a hint to use a
    // double-quoted identifier instead.
    auto script = ParseString("select * from 'foo'");
    ASSERT_FALSE(script->errors.empty());
    EXPECT_NE(script->errors.front().hint.find("double-quoted identifier"), std::string::npos);
}

TEST(ParserTest, NoHintWhenStringLiteralIsValid) {
    // SELECT 1 AS 'one' is accepted by the grammar (sql_col_label_or_string), so no error and no
    // hint should be produced.
    auto script = ParseString("select 1 as 'one'");
    EXPECT_TRUE(script->errors.empty());
}

TEST(ParserTest, HintForStringLiteralAsImplicitAlias) {
    // `select 1 'foo'` errors at SCONST because the implicit-alias rule requires IDENT (only
    // explicit AS accepts a string literal). IDENT would have been valid → hint should appear.
    auto script = ParseString("select 1 'foo'");
    ASSERT_FALSE(script->errors.empty());
    EXPECT_NE(script->errors.front().hint.find("double-quoted identifier"), std::string::npos);
}

TEST(ParserTest, NoHintWhenIdentAlsoInvalid) {
    // `select from foo` errors at FROM because no expression precedes it; an IDENT in place of FROM
    // would not parse either, so no hint should be attached.
    auto script = ParseString("select 1 from from");
    ASSERT_FALSE(script->errors.empty());
    EXPECT_TRUE(script->errors.front().hint.empty());
}

}  // namespace
