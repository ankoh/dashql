#include "dashql/script.h"

#include "dashql/catalog.h"
#include "gtest/gtest.h"

using namespace dashql;

namespace {

std::unique_ptr<Script> LoadSchema(Catalog& catalog, std::string_view sql) {
    auto script = std::make_unique<Script>(catalog);
    script->InsertTextAt(0, sql);
    EXPECT_NO_THROW(script->Analyze());
    EXPECT_NO_THROW(catalog.LoadScript(*script, 0));
    return script;
}

std::unique_ptr<Script> Analyze(Catalog& catalog, std::string_view sql) {
    auto script = std::make_unique<Script>(catalog);
    script->InsertTextAt(0, sql);
    EXPECT_NO_THROW(script->Analyze());
    return script;
}

TEST(AnalyzerInsertTest, ResolvesWriteTargetColumnsAndSourceReads) {
    Catalog catalog;
    auto schema = LoadSchema(catalog, "create table target (id int, label text); "
                                      "create table source (id int, label text);");
    auto script = Analyze(catalog, "insert into target(id, label) "
                                   "select id, label from source returning id");
    auto analyzed = script->GetAnalyzedScript();
    ASSERT_NE(analyzed, nullptr);

    ASSERT_EQ(analyzed->table_references.GetSize(), 2u);
    const TableReference* write_target = nullptr;
    const TableReference* read_source = nullptr;
    analyzed->table_references.ForEach([&](size_t, const TableReference& reference) {
        if (reference.role == TableReference::Role::Write) {
            write_target = &reference;
        } else {
            read_source = &reference;
        }
    });
    ASSERT_NE(write_target, nullptr);
    ASSERT_NE(read_source, nullptr);

    ASSERT_EQ(analyzed->insert_statements.GetSize(), 1u);
    const auto& insert = analyzed->insert_statements[0];
    EXPECT_EQ(&insert.target.get(), write_target);
    EXPECT_TRUE(insert.source_ast_node_id.has_value());
    EXPECT_TRUE(insert.returning);
    ASSERT_EQ(insert.target_columns.size(), 2u);
    EXPECT_EQ(insert.target_columns[0].column_name.get().text, "id");
    EXPECT_EQ(insert.target_columns[1].column_name.get().text, "label");
    EXPECT_TRUE(insert.target_columns[0].resolved.has_value());
    EXPECT_TRUE(insert.target_columns[1].resolved.has_value());
}

TEST(AnalyzerInsertTest, SourceQueryCannotReadFromWriteTarget) {
    Catalog catalog;
    auto schema = LoadSchema(catalog, "create table target (id int);");
    auto script = Analyze(catalog, "insert into target(id) select id");
    auto analyzed = script->GetAnalyzedScript();

    ASSERT_EQ(analyzed->expressions.GetSize(), 1u);
    auto* column = std::get_if<Expression::ColumnRef>(&analyzed->expressions[0].inner);
    ASSERT_NE(column, nullptr);
    EXPECT_FALSE(column->IsResolved());
}

TEST(AnalyzerInsertTest, LeadingCteFeedsSourceAndReturningUsesTarget) {
    Catalog catalog;
    auto schema = LoadSchema(catalog, "create table target (id int);");
    auto script = Analyze(catalog, "with source as (select 1 as id) "
                                   "insert into target(id) select id from source returning id");
    auto analyzed = script->GetAnalyzedScript();

    ASSERT_EQ(analyzed->insert_statements.GetSize(), 1u);
    EXPECT_TRUE(analyzed->insert_statements[0].returning);
    ASSERT_EQ(analyzed->table_references.GetSize(), 2u);
    EXPECT_EQ(analyzed->table_references[0].role, TableReference::Role::Read);
    EXPECT_EQ(analyzed->table_references[1].role, TableReference::Role::Write);

    size_t resolved_columns = 0;
    analyzed->expressions.ForEach([&](size_t, const Expression& expression) {
        auto* column = std::get_if<Expression::ColumnRef>(&expression.inner);
        if (column && column->IsResolved()) ++resolved_columns;
    });
    EXPECT_EQ(resolved_columns, 2u);
}

TEST(AnalyzerInsertTest, UnresolvedTargetRemainsAWriteReference) {
    Catalog catalog;
    auto script = Analyze(catalog, "insert into missing(id) values (1)");
    auto analyzed = script->GetAnalyzedScript();

    ASSERT_EQ(analyzed->table_references.GetSize(), 1u);
    EXPECT_EQ(analyzed->table_references[0].role, TableReference::Role::Write);
    ASSERT_EQ(analyzed->insert_statements.GetSize(), 1u);
    ASSERT_EQ(analyzed->insert_statements[0].target_columns.size(), 1u);
    EXPECT_FALSE(analyzed->insert_statements[0].target_columns[0].resolved.has_value());
}

TEST(AnalyzerInsertTest, RepeatedTargetColumnsRemainSafe) {
    Catalog catalog;
    auto schema = LoadSchema(catalog, "create table target (id int);");
    auto script = Analyze(catalog, "insert into target(id, id) values (1, 2); "
                                   "insert into target(id) values (3)");
    auto analyzed = script->GetAnalyzedScript();

    ASSERT_EQ(analyzed->insert_statements.GetSize(), 2u);
    EXPECT_TRUE(analyzed->insert_statements[0].target_columns[0].resolved.has_value());
    EXPECT_TRUE(analyzed->insert_statements[0].target_columns[1].resolved.has_value());
    EXPECT_TRUE(analyzed->insert_statements[1].target_columns[0].resolved.has_value());
}

TEST(AnalyzerInsertTest, NonRecursiveCtesDoNotResolveSelfOrForwardReferences) {
    Catalog catalog;
    auto schema = LoadSchema(catalog, "create table target (id int);");
    auto script = Analyze(catalog, "with first as (select * from later), "
                                   "later as (select * from later) "
                                   "insert into target select 1");
    auto analyzed = script->GetAnalyzedScript();

    ASSERT_EQ(analyzed->table_references.GetSize(), 3u);
    size_t unresolved_reads = 0;
    analyzed->name_scopes.ForEach([&](size_t, const NameScope& scope) {
        for (auto& [_, table] : scope.referenced_tables_by_name) {
            if (table.IsUnresolvedRelation()) ++unresolved_reads;
        }
    });
    EXPECT_EQ(unresolved_reads, 2u);
}

TEST(AnalyzerInsertTest, ReturningDoesNotResolveFromSourceOutputs) {
    Catalog catalog;
    auto schema = LoadSchema(catalog, "create table target (id int);");
    auto script = Analyze(catalog, "insert into target select 1 as source_only returning source_only");
    auto analyzed = script->GetAnalyzedScript();

    const Expression::ColumnRef* returning = nullptr;
    analyzed->expressions.ForEach([&](size_t, const Expression& expression) {
        auto* column = std::get_if<Expression::ColumnRef>(&expression.inner);
        if (column && column->column_name.column_name.get().text == "source_only") returning = column;
    });
    ASSERT_NE(returning, nullptr);
    EXPECT_FALSE(returning->IsResolved());
}

TEST(AnalyzerInsertTest, LeadingCteDoesNotSeeWriteTarget) {
    Catalog catalog;
    auto schema = LoadSchema(catalog, "create table target (id int);");
    auto script = Analyze(catalog, "with source as (select id) insert into target default values");
    auto analyzed = script->GetAnalyzedScript();

    ASSERT_EQ(analyzed->expressions.GetSize(), 1u);
    auto* column = std::get_if<Expression::ColumnRef>(&analyzed->expressions[0].inner);
    ASSERT_NE(column, nullptr);
    EXPECT_FALSE(column->IsResolved());
}

TEST(AnalyzerInsertTest, PacksInsertMetadata) {
    Catalog catalog;
    auto schema = LoadSchema(catalog, "create table target (id int, label text);");
    auto script = Analyze(catalog, "insert into target(id, label) values (1, 'one') returning id");

    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(script->GetAnalyzedScript()->Pack(builder));
    auto* analyzed = flatbuffers::GetRoot<buffers::analyzer::AnalyzedScript>(builder.GetBufferPointer());

    ASSERT_EQ(analyzed->insert_statements()->size(), 1u);
    auto* insert = analyzed->insert_statements()->Get(0);
    ASSERT_EQ(insert->target_columns()->size(), 2u);
    EXPECT_EQ(insert->target_columns()->Get(0)->column_name()->string_view(), "id");
    EXPECT_NE(insert->target_columns()->Get(0)->resolved_column(), nullptr);
    EXPECT_TRUE(insert->returning());
    ASSERT_EQ(analyzed->table_references()->size(), 1u);
    EXPECT_EQ(analyzed->table_references()->Get(0)->role(), buffers::analyzer::TableReferenceRole::WRITE);
}

}  // namespace
