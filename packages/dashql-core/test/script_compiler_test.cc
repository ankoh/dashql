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
