#include "dashql/script.h"

#include <initializer_list>
#include <string_view>

#include "dashql/catalog.h"
#include "gtest/gtest.h"

using namespace dashql;

namespace {

const CatalogEntry::TableDeclaration& AnalyzeSingleTable(std::string_view input, Catalog& catalog,
                                                         std::unique_ptr<Script>& script) {
    script = std::make_unique<Script>(catalog);
    script->InsertTextAt(0, input);
    script->Analyze();
    EXPECT_EQ(script->GetAnalyzedScript()->GetTables().GetSize(), 1);
    return script->GetAnalyzedScript()->GetTables()[0];
}

void ExpectColumns(const CatalogEntry::TableDeclaration& table,
                   std::initializer_list<std::string_view> expected) {
    ASSERT_EQ(table.table_columns.size(), expected.size());
    size_t i = 0;
    for (auto name : expected) {
        EXPECT_EQ(table.table_columns[i++].column_name.get().text, name);
    }
}

TEST(AnalyzerDeclarationTest, CreateTableAsDerivesNamedSelectColumns) {
    Catalog catalog;
    Script schema{catalog};
    schema.InsertTextAt(0, "create table source (id int, amount int)");
    ASSERT_NO_THROW(schema.Analyze());
    ASSERT_NO_THROW(catalog.LoadScript(schema, 0));

    std::unique_ptr<Script> script;
    auto& table = AnalyzeSingleTable(
        "create table result as "
        "with selected as (select * from source) "
        "select *, amount + 1, id as renamed from selected",
        catalog, script);

    EXPECT_EQ(table.table_name.table_name.get().text, "result");
    EXPECT_EQ(table.ast_statement_id, 0);
    ExpectColumns(table, {"amount", "id", "renamed"});
}

TEST(AnalyzerDeclarationTest, ExplicitCreateAliasesOverrideSelectOutputNames) {
    Catalog catalog;
    std::unique_ptr<Script> script;
    auto& table = AnalyzeSingleTable("create view result(first, second) as select 1 as old, 2 as names", catalog,
                                     script);

    EXPECT_EQ(table.table_name.table_name.get().text, "result");
    EXPECT_EQ(table.ast_statement_id, 0);
    ExpectColumns(table, {"first", "second"});
}

TEST(AnalyzerDeclarationTest, ExplicitCreateTableAliasesOverrideSelectOutputNames) {
    Catalog catalog;
    std::unique_ptr<Script> script;
    auto& table = AnalyzeSingleTable("create table result(first, second) as select 1 as old, 2 as names", catalog,
                                     script);

    EXPECT_EQ(table.ast_statement_id, 0);
    ExpectColumns(table, {"first", "second"});
}

TEST(AnalyzerDeclarationTest, ViewDerivesCteAliasColumns) {
    Catalog catalog;
    std::unique_ptr<Script> script;
    auto& table = AnalyzeSingleTable(
        "create view result as with source(first, second) as (select 1 as old, 2 as names) select * from source",
        catalog, script);

    EXPECT_EQ(table.ast_statement_id, 0);
    ExpectColumns(table, {"first", "second"});
}

TEST(AnalyzerDeclarationTest, SelectIntoDeclaresTableFromResolvedStar) {
    Catalog catalog;
    Script schema{catalog};
    schema.InsertTextAt(0, "create table source (id int, amount int)");
    ASSERT_NO_THROW(schema.Analyze());
    ASSERT_NO_THROW(catalog.LoadScript(schema, 0));

    std::unique_ptr<Script> script;
    auto& table = AnalyzeSingleTable("select *, id as copied_id, amount + 1 into result from source", catalog, script);

    EXPECT_EQ(table.table_name.table_name.get().text, "result");
    EXPECT_EQ(table.ast_statement_id, 0);
    ExpectColumns(table, {"amount", "id", "copied_id"});
}

TEST(AnalyzerDeclarationTest, OrdinaryCreateTableKeepsDeclaredColumnsAndStatementId) {
    Catalog catalog;
    std::unique_ptr<Script> script;
    auto& table = AnalyzeSingleTable("create table result (z int, a int)", catalog, script);

    EXPECT_EQ(table.ast_statement_id, 0);
    ExpectColumns(table, {"a", "z"});
}

TEST(AnalyzerDeclarationTest, DerivedTableColumnsAreIndexed) {
    Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, "create table source (id int); "
                           "create table derived as select id as copied_id from source; "
                           "select copied_id from derived");
    ASSERT_NO_THROW(script.Analyze());

    auto analyzed = script.GetAnalyzedScript();
    ASSERT_EQ(analyzed->GetTables().GetSize(), 2);
    auto& derived = analyzed->GetTables()[1];
    EXPECT_EQ(derived.ast_statement_id, 1);
    ASSERT_TRUE(derived.table_columns_by_name.contains("copied_id"));

    EXPECT_TRUE(derived.table_columns_by_name.contains("copied_id"));
}

TEST(AnalyzerDeclarationTest, SetOperationUsesLeftInputColumns) {
    Catalog catalog;
    std::unique_ptr<Script> script;
    auto& table = AnalyzeSingleTable("create view result as select 1 as first union all select 2 as second", catalog,
                                     script);

    ExpectColumns(table, {"first"});
}

}  // namespace
