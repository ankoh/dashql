#include "dashql/script_compiler.h"

#include "dashql/catalog.h"
#include "dashql/script.h"
#include "gtest/gtest.h"

namespace dashql {
namespace {

buffers::formatting::FormattingConfigT ExecutionConfig() {
    buffers::formatting::FormattingConfigT config;
    config.mode = buffers::formatting::FormattingMode::INLINE;
    config.dialect = buffers::formatting::FormattingDialect::HYPER;
    config.max_width = 120;
    config.indentation_width = 2;
    config.lower_relational_pipes = true;
    return config;
}

ScriptCompilationResult Compile(std::string_view text) {
    static Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, text);
    return script.CompileQuery(ExecutionConfig());
}

ScriptCompilationResult CompileWithoutExtensions(std::string_view text) {
    static Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, text);
    return script.CompileQuery(ExecutionConfig(), {.allow_extensions = false});
}

TEST(ScriptCompilerTest, CompilesOrderedPipelineDefinitions) {
    auto result = Compile(R"SQL(
FROM sales |> AGGREGATE sum(amount) AS total |> AS table1;
FROM refunds |> AGGREGATE sum(amount) AS total |> AS table2;
FROM table1 |> UNION ALL (FROM table2) |> ORDER BY total;
)SQL");

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    EXPECT_EQ(result.terminal_statement_id, 2);
    EXPECT_NE(result.sql.find("with table1 as (select sum(amount) as total"), std::string::npos) << result.sql;
    EXPECT_NE(result.sql.find("table2 as (select sum(amount) as total"), std::string::npos) << result.sql;
    EXPECT_NE(result.sql.find("union all"), std::string::npos);
    EXPECT_EQ(result.sql.find("|>"), std::string::npos);
    EXPECT_FALSE(result.sql.ends_with(';'));
}

TEST(ScriptCompilerTest, PreservesAggregateTargetList) {
    auto result = Compile(R"SQL(
FROM events
|> EXTEND date_trunc('hour', event_timestamp) AS ts_hour
|> AGGREGATE ts_hour, sum(processed_rows) AS processed_rows GROUP BY ts_hour
|> SELECT sum(processed_rows) OVER (ORDER BY ts_hour ASC) AS processed_rows_running;
)SQL");

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    EXPECT_NE(result.sql.find("select ts_hour, sum(processed_rows) as processed_rows"), std::string::npos)
        << result.sql;
    EXPECT_EQ(result.sql.find("select ts_hour, ts_hour"), std::string::npos) << result.sql;
}

TEST(ScriptCompilerTest, ProjectsImplicitAggregateGroupKeys) {
    auto result = Compile(R"SQL(
FROM events
|> EXTEND date_trunc('hour', event_timestamp) AS ts_hour
|> AGGREGATE count(*) AS cnt GROUP BY ts_hour
|> VISUALIZE USING vegalite (
    mark => bar,
    encoding => (
        x => (field => ts_hour, type => temporal),
        y => (field => cnt, type => quantitative)
    )
);
)SQL");

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    EXPECT_NE(result.sql.find("select ts_hour, count(*) as cnt"), std::string::npos) << result.sql;
    EXPECT_EQ(result.sql.find("visualize"), std::string::npos) << result.sql;
    ASSERT_TRUE(result.visualization.has_value());
}

TEST(ScriptCompilerTest, MatchesFormattedExplicitAggregateGroupKeys) {
    auto result = Compile("FROM events |> AGGREGATE ( ts_hour ) AS bucket, count(*) AS cnt GROUP BY ts_hour;");

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    EXPECT_EQ(result.sql.find("select ts_hour, ts_hour"), std::string::npos) << result.sql;
}

TEST(ScriptCompilerTest, PreservesInternalPipeAlias) {
    auto result = Compile(R"SQL(
FROM sales |> AS s |> LEFT JOIN regions AS r ON s.region_id = r.id |> AS enriched;
FROM enriched;
)SQL");

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    EXPECT_NE(result.sql.find("as s left join regions r"), std::string::npos);
    EXPECT_NE(result.sql.find("with enriched as"), std::string::npos);
}

TEST(ScriptCompilerTest, MergesFinalCTEs) {
    auto result = Compile(R"SQL(
FROM sales |> WHERE amount > 0 |> AS active_sales;
WITH regional AS (SELECT * FROM active_sales) SELECT * FROM regional;
)SQL");

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    EXPECT_NE(result.sql.find("with active_sales as"), std::string::npos);
    EXPECT_NE(result.sql.find(", regional as"), std::string::npos);
    EXPECT_EQ(result.sql.find("with with"), std::string::npos);
}

TEST(ScriptCompilerTest, PrependsLocalRelationWhenFinalCTEHasSameName) {
    auto result = Compile(R"SQL(
FROM sales |> WHERE amount > 0 |> AS active_sales;
WITH active_sales AS (SELECT * FROM refunds) SELECT * FROM active_sales;
)SQL");

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    auto local = result.sql.find("with active_sales as (select * from (select * from sales)");
    auto final = result.sql.find("active_sales as (select * from refunds)");
    ASSERT_NE(local, std::string::npos) << result.sql;
    ASSERT_NE(final, std::string::npos) << result.sql;
    EXPECT_LT(local, final);
}

TEST(ScriptCompilerTest, RejectsInvalidPrefix) {
    auto result = Compile("SELECT 1; FROM sales |> WHERE amount > 0;");
    ASSERT_EQ(result.errors.size(), 1);
    EXPECT_EQ(result.errors.front().code, buffers::execution::ScriptCompilationErrorCode::PREFIX_NOT_LOCAL_RELATION);
}

TEST(ScriptCompilerTest, ReturnsPlainSQLVerbatim) {
    constexpr std::string_view sql = "  SELECT 1 AS x; -- preserve formatting\n";
    auto result = Compile(sql);

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    EXPECT_EQ(result.kind, buffers::execution::ScriptCompilationStatementKind::QUERY);
    EXPECT_EQ(result.terminal_statement_id, 0);
    EXPECT_EQ(result.sql, sql);
}

TEST(ScriptCompilerTest, RejectsExtensionsWhenDisabled) {
    auto pipe = CompileWithoutExtensions("FROM sales |> WHERE amount > 0;");
    ASSERT_EQ(pipe.errors.size(), 1);
    EXPECT_EQ(pipe.errors.front().code, buffers::execution::ScriptCompilationErrorCode::EXTENSIONS_DISABLED);

    auto visualize = CompileWithoutExtensions(
        "SELECT 1 AS value |> VISUALIZE USING vegalite (mark => bar, encoding => (x => (field => value)));");
    ASSERT_EQ(visualize.errors.size(), 1);
    EXPECT_EQ(visualize.errors.front().code, buffers::execution::ScriptCompilationErrorCode::EXTENSIONS_DISABLED);
}

TEST(ScriptCompilerTest, RejectsDefinitionOnlyScript) {
    auto result = Compile("FROM sales |> AS local_sales;");
    ASSERT_EQ(result.errors.size(), 1);
    EXPECT_EQ(result.errors.front().code,
              buffers::execution::ScriptCompilationErrorCode::LAST_STATEMENT_IS_LOCAL_RELATION);
}

TEST(ScriptCompilerTest, EmitsForwardAndSelfReferences) {
    auto forward = Compile("FROM later |> AS first; FROM sales |> AS later; FROM first;");
    ASSERT_TRUE(forward.errors.empty()) << (forward.errors.empty() ? "" : forward.errors.front().message);
    EXPECT_NE(forward.sql.find("with first as"), std::string::npos) << forward.sql;
    EXPECT_NE(forward.sql.find("later as"), std::string::npos) << forward.sql;

    auto self = Compile("FROM local_sales |> AS local_sales; FROM local_sales;");
    ASSERT_TRUE(self.errors.empty()) << (self.errors.empty() ? "" : self.errors.front().message);
    EXPECT_NE(self.sql.find("with local_sales as"), std::string::npos) << self.sql;
}

TEST(ScriptCompilerTest, CompilesVisualizationSourceWithLocalRelations) {
    auto result = Compile(R"SQL(
FROM sales |> SELECT amount |> AS local_sales;
FROM local_sales |> VISUALIZE USING vegalite (mark => bar, encoding => (x => (field => amount)));
)SQL");

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    ASSERT_TRUE(result.visualization.has_value());
    EXPECT_EQ(result.visualization->renderer, "vegalite");
    EXPECT_FALSE(result.visualization->vegalite_spec.empty());
    EXPECT_NE(result.sql.find("with local_sales as"), std::string::npos);
    EXPECT_EQ(result.sql.find("visualize"), std::string::npos);
}

TEST(ScriptCompilerTest, AnalyzerResolvesOrderedLocalRelationColumns) {
    Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, R"SQL(
FROM sales |> SELECT amount |> AS local_sales;
SELECT amount FROM local_sales;
)SQL");
    script.Analyze();

    auto& analyzed = *script.analyzed_script;
    ASSERT_EQ(analyzed.script_local_relations.size(), 1);
    EXPECT_EQ(analyzed.script_local_relations.front().relation_name.get().text, "local_sales");
    EXPECT_EQ(analyzed.script_local_relations.front().statement_id, 0);
    auto& resolved_relation = analyzed.script_local_resolved_relations[
        analyzed.script_local_relations.front().resolved_relation_id];
    ASSERT_NE(resolved_relation.child_scope, nullptr);
    ASSERT_EQ(resolved_relation.child_scope->output_columns.size(), 1);
    EXPECT_EQ(resolved_relation.child_scope->output_columns.front().column_name.get().text,
              "amount");

    bool resolved_local_column = false;
    analyzed.expressions.ForEach([&](size_t, const Expression& expression) {
        if (expression.ast_statement_id != 1) return;
        auto* column = std::get_if<Expression::ColumnRef>(&expression.inner);
        if (!column || column->column_name.column_name.get().text != "amount") return;
        resolved_local_column = column->IsResolved();
    });
    EXPECT_TRUE(resolved_local_column);
}

TEST(ScriptCompilerTest, AnalyzerDoesNotResolveForwardLocalRelation) {
    Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, R"SQL(
FROM later |> SELECT amount |> AS first;
FROM sales |> SELECT amount |> AS later;
FROM first;
)SQL");
    script.Analyze();

    auto& analyzed = *script.analyzed_script;
    bool forward_ref_is_unresolved = false;
    analyzed.table_references.ForEach([&](size_t, const TableReference& table) {
        if (table.ast_statement_id != 0) return;
        auto* relation = std::get_if<TableReference::RelationExpression>(&table.inner);
        if (!relation || relation->table_name.table_name.get().text != "later") return;
        forward_ref_is_unresolved = !relation->resolved_table.has_value();
    });
    EXPECT_TRUE(forward_ref_is_unresolved);
}

}  // namespace
}  // namespace dashql
