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
    return config;
}

ScriptCompilationResult Compile(std::string_view text, bool allow_extensions = true) {
    static Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, text);
    return script.CompileQuery(ExecutionConfig(), {.allow_extensions = allow_extensions});
}

TEST(ScriptCompilerTest, ReturnsPlainSQLVerbatim) {
    constexpr std::string_view sql = "  SELECT 1 AS x; -- preserve formatting\n";
    auto result = Compile(sql);

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    EXPECT_EQ(result.kind, buffers::execution::ScriptCompilationStatementKind::QUERY);
    EXPECT_EQ(result.terminal_statement_id, 0);
    EXPECT_EQ(result.sql, sql);
}

TEST(ScriptCompilerTest, ClassifiesInsertAsQuery) {
    constexpr std::string_view sql = "INSERT INTO target VALUES (1);";
    auto result = Compile(sql);

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    EXPECT_EQ(result.kind, buffers::execution::ScriptCompilationStatementKind::QUERY);
    EXPECT_EQ(result.terminal_statement_id, 0);
    EXPECT_EQ(result.sql, sql);
}

TEST(ScriptCompilerTest, CompilesStatementsInOrder) {
    auto result = Compile("CREATE TABLE t (v INT); INSERT INTO t VALUES (1); SELECT * FROM t;");

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    ASSERT_EQ(result.statements.size(), 3);
    EXPECT_EQ(result.statements[0].kind, buffers::execution::CompiledScriptStatementKind::COMMAND);
    EXPECT_EQ(result.statements[0].sql, "CREATE TABLE t (v INT);");
    EXPECT_EQ(result.statements[1].sql, "INSERT INTO t VALUES (1);");
    EXPECT_EQ(result.statements[2].kind, buffers::execution::CompiledScriptStatementKind::OUTPUT);
    EXPECT_EQ(result.statements[2].sql, "SELECT * FROM t;");
}

TEST(ScriptCompilerTest, RejectsOutputStatementBeforeEnd) {
    auto result = Compile("SELECT 1; CREATE TABLE t (v INT);");

    ASSERT_EQ(result.errors.size(), 1);
    EXPECT_EQ(result.errors.front().code,
              buffers::execution::ScriptCompilationErrorCode::OUTPUT_STATEMENT_NOT_LAST);
    EXPECT_EQ(result.errors.front().statement_id, 0);
}

TEST(ScriptCompilerTest, AllowsCommandOnlyScript) {
    auto result = Compile("SET x = 1; CREATE TABLE t (v INT);");

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    ASSERT_EQ(result.statements.size(), 2);
    EXPECT_EQ(result.statements[1].kind, buffers::execution::CompiledScriptStatementKind::COMMAND);
}

TEST(ScriptCompilerTest, TreatsInsertReturningAndSelectIntoAsOutput) {
    auto insert = Compile("INSERT INTO t VALUES (1) RETURNING *;");
    ASSERT_TRUE(insert.errors.empty()) << (insert.errors.empty() ? "" : insert.errors.front().message);
    ASSERT_EQ(insert.statements.size(), 1);
    EXPECT_EQ(insert.statements[0].kind, buffers::execution::CompiledScriptStatementKind::OUTPUT);

    auto select_into = Compile("SELECT 1 INTO t;");
    ASSERT_TRUE(select_into.errors.empty())
        << (select_into.errors.empty() ? "" : select_into.errors.front().message);
    ASSERT_EQ(select_into.statements.size(), 1);
    EXPECT_EQ(select_into.statements[0].kind, buffers::execution::CompiledScriptStatementKind::OUTPUT);
}

TEST(ScriptCompilerTest, CompilesTrailingVisualization) {
    auto result = Compile(R"SQL(
WITH source AS (SELECT category, amount FROM sales)
SELECT category, sum(amount) AS total
FROM source
GROUP BY category
ORDER BY total DESC
LIMIT 10
VISUALIZE USING vegalite (
    mark => bar,
    encoding => (
        x => (field => category, type => nominal),
        y => (field => total, type => quantitative)
    )
);
)SQL");

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    EXPECT_EQ(result.kind, buffers::execution::ScriptCompilationStatementKind::VISUALIZE);
    EXPECT_EQ(result.terminal_statement_id, 0);
    EXPECT_NE(result.sql.find("with source as"), std::string::npos) << result.sql;
    EXPECT_NE(result.sql.find("order by total desc limit 10"), std::string::npos) << result.sql;
    EXPECT_EQ(result.sql.find("visualize"), std::string::npos) << result.sql;
    EXPECT_FALSE(result.sql.ends_with(';'));
    ASSERT_TRUE(result.visualization.has_value());
    EXPECT_EQ(result.visualization->renderer, "vegalite");
    EXPECT_FALSE(result.visualization->vegalite_spec.empty());
    ASSERT_EQ(result.statements.size(), 1);
    EXPECT_EQ(result.statements[0].kind, buffers::execution::CompiledScriptStatementKind::VISUALIZE);
}

TEST(ScriptCompilerTest, CompilesUmapVisualization) {
    auto result = Compile(R"SQL(
SELECT embedding, cluster_id FROM embeddings
VISUALIZE USING umap (
    vector => embedding,
    category => cluster_id,
    neighbors => 15,
    min_dist => 0.1,
    metric => cosine
);
)SQL");

    ASSERT_TRUE(result.errors.empty()) << (result.errors.empty() ? "" : result.errors.front().message);
    ASSERT_TRUE(result.visualization.has_value());
    EXPECT_EQ(result.visualization->renderer, "umap");
    EXPECT_FALSE(result.visualization->umap_spec.empty());
    EXPECT_EQ(result.sql.find("visualize"), std::string::npos);
}

TEST(ScriptCompilerTest, RejectsVisualizationWhenExtensionsDisabled) {
    auto result = Compile(
        "SELECT 1 AS value VISUALIZE USING vegalite (mark => bar, encoding => (x => (field => value)));",
        false);

    ASSERT_EQ(result.errors.size(), 1);
    EXPECT_EQ(result.errors.front().code, buffers::execution::ScriptCompilationErrorCode::EXTENSIONS_DISABLED);
}

TEST(ScriptCompilerTest, RejectsOldPipeSyntax) {
    auto result = Compile("SELECT * FROM sales |> VISUALIZE USING vegalite (mark => bar);");
    ASSERT_FALSE(result.errors.empty());
    EXPECT_EQ(result.errors.front().code, buffers::execution::ScriptCompilationErrorCode::PARSER_ERROR);
}

}  // namespace
}  // namespace dashql
