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
        auto [scanned, scannerStatus] = Scanner::Scan(buffer, 0, 2);
        ASSERT_EQ(scannerStatus, buffers::status::StatusCode::OK);
        auto [parsed, parserStatus] = Parser::Parse(scanned);
        ASSERT_EQ(parserStatus, buffers::status::StatusCode::OK);
        script = std::move(parsed);
    };
    /// Test if ast node matches
    auto test_node_at_offset = [&](size_t text_offset, size_t expected_statement_id,
                                   buffers::parser::NodeType expect_node_type, sx::parser::Location expect_loc) {
        auto result = script->FindNodeAtOffset(text_offset);
        ASSERT_TRUE(result.has_value()) << "offset=" << text_offset;
        auto [statement_id, node_id] = *result;
        ASSERT_EQ(statement_id, expected_statement_id);
        ASSERT_LT(node_id, script->nodes.size());
        auto& node = script->nodes[node_id];
        ASSERT_EQ(node.node_type(), expect_node_type);
        ASSERT_EQ(node.location().offset(), expect_loc.offset());
        ASSERT_EQ(node.location().length(), expect_loc.length());
    };

    parse("select 1");
    test_node_at_offset(0, 0, buffers::parser::NodeType::OBJECT_SQL_SELECT, sx::parser::Location(0, 8));
    test_node_at_offset(1, 0, buffers::parser::NodeType::OBJECT_SQL_SELECT, sx::parser::Location(0, 8));
    test_node_at_offset(2, 0, buffers::parser::NodeType::OBJECT_SQL_SELECT, sx::parser::Location(0, 8));
    test_node_at_offset(7, 0, buffers::parser::NodeType::LITERAL_INTEGER, sx::parser::Location(7, 1));
}

}  // namespace
