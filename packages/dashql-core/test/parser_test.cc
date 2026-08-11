#include "dashql/parser/parser.h"

#include <algorithm>
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

TEST(ParserTest, ParsesDollarParametersAndArraySlices) {
    constexpr std::array<std::string_view, 5> inputs = {
        "SELECT $name",
        "SELECT $1",
        "SELECT values[:2]",
        "SELECT values[1:]",
        "SELECT values[:]",
    };

    for (auto input : inputs) {
        auto script = ParseString(input);
        EXPECT_TRUE(script->errors.empty()) << input << ": "
                                           << (script->errors.empty() ? "" : script->errors.front().message);
        EXPECT_EQ(script->statements.size(), 1u) << input;
    }
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

TEST(ParserTest, AssociatesLeadingCommentBlocksWithStatements) {
    constexpr std::string_view text =
        "-- first statement\n"
        "-- has two lines\n"
        "select 1;\n"
        "\n"
        "/* second statement */\n"
        "select 2; -- trailing\n"
        "select 3";
    auto script = ParseString(text);

    ASSERT_EQ(script->statements.size(), 3u);
    ASSERT_EQ(script->scanned_script->comments.size(), 4u);
    auto descriptions = script->AssociateDescriptions();
    ASSERT_EQ(descriptions.size(), 3u);

    auto& first = descriptions[0];
    EXPECT_EQ(first.description_begin, 0u);
    EXPECT_EQ(first.description_count, 2u);
    EXPECT_EQ(text.substr(first.statement_span.offset(), first.statement_span.length()), "select 1");
    EXPECT_EQ(text.substr(first.source_span.offset(), first.source_span.length()), "select 1;");

    auto& second = descriptions[1];
    EXPECT_EQ(second.description_begin, 2u);
    EXPECT_EQ(second.description_count, 1u);
    EXPECT_EQ(text.substr(second.statement_span.offset(), second.statement_span.length()), "select 2");
    EXPECT_EQ(text.substr(second.source_span.offset(), second.source_span.length()), "select 2; -- trailing");

    auto& third = descriptions[2];
    EXPECT_EQ(third.description_count, 0u);
    EXPECT_EQ(text.substr(third.statement_span.offset(), third.statement_span.length()), "select 3");
    EXPECT_EQ(text.substr(third.source_span.offset(), third.source_span.length()), "select 3");
}

TEST(ParserTest, StatementSpanExcludesWhitespaceBeforeSeparator) {
    constexpr std::string_view text = "  select 'Grüße;'\n  ; -- trailing";
    auto script = ParseString(text);

    ASSERT_TRUE(script->errors.empty());
    ASSERT_EQ(script->statements.size(), 1u);
    auto description = script->AssociateDescriptions().front();
    EXPECT_EQ(text.substr(description.statement_span.offset(), description.statement_span.length()),
              "select 'Grüße;'");
    EXPECT_EQ(text.substr(description.source_span.offset(), description.source_span.length()),
              "select 'Grüße;'\n  ; -- trailing");
}

TEST(ParserTest, ParsesHyperQueryWithObfuscatedLiterals) {
    constexpr std::string_view text = R"SQL(
with source as (
    select /*String(C5FA)*/ as value
)
(select count() from source where 1 > (/*Integer(4888)*/))
limit /*Integer(FCD0)*/
)SQL";

    auto script = ParseString(text);

    EXPECT_TRUE(script->errors.empty());
    ASSERT_EQ(script->statements.size(), 1u);
    EXPECT_EQ(script->statements.front().type, buffers::parser::StatementType::SELECT);
}

TEST(ParserTest, ParsesRelationalPipeStages) {
    constexpr std::array<std::string_view, 11> inputs = {
        "FROM sales",
        "FROM sales |> WHERE revenue > 0 |> SELECT region, revenue AS amount",
        "SELECT * FROM sales |> EXTEND revenue * 1.2 AS adjusted_revenue",
        "FROM sales |> AGGREGATE sum(revenue) AS total GROUP BY region",
        "FROM sales |> AGGREGATE GROUP BY region",
        "FROM sales |> DISTINCT",
        "FROM sales |> AS s |> LEFT JOIN regions AS r ON s.region_id = r.id",
        "FROM current_sales |> UNION ALL (FROM archived_sales), (SELECT * FROM forecast_sales)",
        "FROM sales |> ORDER BY revenue DESC NULLS LAST |> LIMIT 10 OFFSET 5",
        "WITH regions AS (SELECT * FROM region_dim) FROM sales |> JOIN regions USING (region_id)",
        "(FROM sales |> WHERE revenue > 0) |> LIMIT 10",
    };

    for (auto input : inputs) {
        auto script = ParseString(input);
        EXPECT_TRUE(script->errors.empty()) << input << ": "
                                           << (script->errors.empty() ? "" : script->errors.front().message);
        ASSERT_EQ(script->statements.size(), 1u) << input;
        EXPECT_EQ(script->statements.front().type, buffers::parser::StatementType::SELECT) << input;
    }
}

TEST(ParserTest, RejectsWithAsRelationalPipeStage) {
    auto script = ParseString(
        "FROM sales |> WITH regions AS (SELECT * FROM region_dim) |> JOIN regions USING (region_id)");

    EXPECT_FALSE(script->errors.empty());
}

TEST(ParserTest, ParsesRelationalPipesInSelectContexts) {
    constexpr std::array<std::string_view, 6> inputs = {
        "SELECT * FROM (FROM sales |> WHERE revenue > 0) AS filtered",
        "SELECT (FROM sales |> AGGREGATE count(*) AS total)",
        "SELECT EXISTS (FROM sales |> WHERE revenue > 0)",
        "CREATE TABLE filtered AS FROM sales |> WHERE revenue > 0",
        "CREATE VIEW filtered AS FROM sales |> WHERE revenue > 0",
        "EXPLAIN FROM sales |> WHERE revenue > 0",
    };

    for (auto input : inputs) {
        auto script = ParseString(input);
        EXPECT_TRUE(script->errors.empty()) << input << ": "
                                           << (script->errors.empty() ? "" : script->errors.front().message);
        EXPECT_EQ(script->statements.size(), 1u) << input;
    }
}

TEST(ParserTest, ParsesRelationalPipeInCte) {
    constexpr std::string_view input =
        "WITH filtered AS (FROM sales |> WHERE revenue > 0) SELECT * FROM filtered";
    auto script = ParseString(input);

    EXPECT_TRUE(script->errors.empty())
        << (script->errors.empty() ? "" : script->errors.front().message);
    EXPECT_EQ(script->statements.size(), 1u);
}

TEST(ParserTest, RestoresCapturedPrefixStateStack) {
    constexpr std::string_view text = "WITH source AS (SELECT 1) SELECT * FROM source";
    rope::Rope buffer{128};
    buffer.Insert(0, text);
    auto scanned = Scanner::Scan(buffer, 0, 2);
    auto& symbols = scanned->GetSymbols();
    ChunkBufferEntryID cursor{0, 0};
    while (!symbols.IsAtEOF(cursor) && symbols[cursor].location.offset() < text.find("source", 5)) {
        cursor = symbols.GetNext(cursor);
    }

    auto expected = Parser::ParseUntilWithSnapshot(*scanned, cursor);
    ASSERT_TRUE(expected.prefix.reached_target);
    ASSERT_FALSE(expected.prefix.state_stack.empty());

    ParseContext context{*scanned};
    Parser parser{context};
    parser.RestorePrefix(expected.prefix);
    ASSERT_EQ(parser.GetStackSize(), expected.prefix.state_stack.size());
    for (size_t i = 0; i < expected.prefix.state_stack.size(); ++i) {
        EXPECT_EQ(parser.GetStackState(i), expected.prefix.state_stack[expected.prefix.state_stack.size() - 1 - i]);
    }
}

TEST(ParserTest, DetectsParsedScriptFeatures) {
    auto plain = ParseString("SELECT '|>' AS operator_text");
    EXPECT_EQ(plain->feature_flags, 0u);

    auto pipe = ParseString("FROM sales |> WHERE revenue > 0");
    EXPECT_EQ(pipe->feature_flags,
              static_cast<uint32_t>(buffers::parser::ParsedScriptFeature::RELATIONAL_PIPE));

    auto visualize = ParseString("SELECT 1 |> VISUALIZE USING vegalite (mark => bar)");
    EXPECT_EQ(visualize->feature_flags,
              static_cast<uint32_t>(buffers::parser::ParsedScriptFeature::VISUALIZE));

    auto piped_visualize =
        ParseString("FROM sales |> WHERE revenue > 0 |> VISUALIZE USING vegalite (mark => bar)");
    EXPECT_EQ(piped_visualize->feature_flags,
              static_cast<uint32_t>(buffers::parser::ParsedScriptFeature::RELATIONAL_PIPE) |
                  static_cast<uint32_t>(buffers::parser::ParsedScriptFeature::VISUALIZE));
}

TEST(ParserTest, ParsesRelationalPipeVisualization) {
    constexpr std::string_view input = R"SQL(
FROM sales
|> WHERE revenue > 0
|> VISUALIZE USING vegalite (mark => bar)
)SQL";

    auto script = ParseString(input);
    EXPECT_TRUE(script->errors.empty()) << (script->errors.empty() ? "" : script->errors.front().message);
    ASSERT_EQ(script->statements.size(), 1u);
    EXPECT_EQ(script->statements.front().type, buffers::parser::StatementType::VIS_VISUALISE);

    auto& root = script->nodes[script->statements.front().root];
    ASSERT_EQ(root.node_type(), buffers::parser::NodeType::OBJECT_VIS_VISUALISE);
    auto source = std::find_if(script->nodes.begin() + root.children_begin_or_value(),
                               script->nodes.begin() + root.children_begin_or_value() + root.children_count(),
                               [](const auto& node) {
                                   return node.attribute_key() == buffers::parser::AttributeKey::VIS_VISUALISE_SELECT;
                               });
    ASSERT_NE(source, script->nodes.end());
    EXPECT_EQ(source->node_type(), buffers::parser::NodeType::OBJECT_EXT_PIPE);
}

}  // namespace
