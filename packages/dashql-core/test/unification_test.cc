#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/external.h"
#include "dashql/script.h"
#include "gtest/gtest.h"

#include <algorithm>
#include <barrier>
#include <exception>
#include <thread>
#include <unordered_set>
#include <vector>

using namespace dashql;

namespace {

TEST(UnificationTest, EmptyCatalogHasNoSchema) {
    Catalog catalog;

    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(catalog.Flatten(fb));
    auto flat = flatbuffers::GetRoot<buffers::catalog::FlatCatalog>(fb.GetBufferPointer());
    EXPECT_EQ(flat->databases()->size(), 0);
    EXPECT_EQ(flat->schemas()->size(), 0);
}

TEST(UnificationTest, SingleTableInDefaultSchema) {
    Catalog catalog;

    Script script{catalog};
    script.InsertTextAt(0, "create table foo(a int);");

    ASSERT_NO_THROW(script.Scan());
    ASSERT_NO_THROW(script.Parse());
    ASSERT_NO_THROW(script.Analyze());
    ASSERT_NO_THROW(catalog.LoadScript(script, 1));

    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(catalog.Flatten(fb));
    auto flat = flatbuffers::GetRoot<buffers::catalog::FlatCatalog>(fb.GetBufferPointer());

    // "foo" should get expanded to dashql.default.foo
    // The flat catalog should therefore have exactly 1 database, 1 schema, 1 table, 1 column
    ASSERT_EQ(flat->databases()->size(), 1);
    ASSERT_EQ(flat->schemas()->size(), 1);
    ASSERT_EQ(flat->tables()->size(), 1);
    ASSERT_EQ(flat->columns()->size(), 1);
    ASSERT_EQ(flat->databases()->Get(0)->catalog_object_id(), INITIAL_DATABASE_ID);
    ASSERT_EQ(flat->schemas()->Get(0)->catalog_object_id(), INITIAL_SCHEMA_ID);
    ASSERT_EQ(flat->tables()->Get(0)->catalog_object_id(), ExternalObjectID(script.GetCatalogEntryId(), 0).Pack());

    // Check names
    EXPECT_EQ(flat->name_dictionary()->size(), 3);
    EXPECT_EQ(flat->name_dictionary()->Get(flat->databases()->Get(0)->name_id())->string_view(), "");
    EXPECT_EQ(flat->name_dictionary()->Get(flat->schemas()->Get(0)->name_id())->string_view(), "");
    EXPECT_EQ(flat->name_dictionary()->Get(flat->tables()->Get(0)->name_id())->string_view(), "foo");
    EXPECT_EQ(flat->name_dictionary()->Get(flat->columns()->Get(0)->name_id())->string_view(), "a");
}

TEST(UnificationTest, MultipleTablesInDefaultSchema) {
    Catalog catalog;

    Script schema0{catalog};
    Script schema1{catalog};
    schema0.InsertTextAt(0, "create table foo(a int);");
    schema1.InsertTextAt(0, "create table bar(a int);");

    ASSERT_NO_THROW(schema0.Analyze());
    ASSERT_NO_THROW(catalog.LoadScript(schema0, 1));

    ASSERT_NO_THROW(schema1.Analyze());
    ASSERT_NO_THROW(catalog.LoadScript(schema1, 2));

    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(catalog.Flatten(fb));
    auto flat = flatbuffers::GetRoot<buffers::catalog::FlatCatalog>(fb.GetBufferPointer());

    // "foo" should get expanded to dashql.default.foo
    // "bar" should get expanded to dashql.default.foo
    // both should be added to the same database

    ASSERT_EQ(flat->databases()->size(), 1);
    ASSERT_EQ(flat->schemas()->size(), 1);
    ASSERT_EQ(flat->tables()->size(), 2);
    ASSERT_EQ(flat->columns()->size(), 2);

    EXPECT_EQ(flat->databases()->Get(0)->catalog_object_id(), INITIAL_DATABASE_ID);
    EXPECT_EQ(flat->schemas()->Get(0)->catalog_object_id(), INITIAL_SCHEMA_ID);

    // Tables names are ordered lexicographically in the flattend schema
    EXPECT_EQ(flat->tables()->Get(0)->catalog_object_id(), ExternalObjectID(schema1.GetCatalogEntryId(), 0).Pack());
    EXPECT_EQ(flat->tables()->Get(1)->catalog_object_id(), ExternalObjectID(schema0.GetCatalogEntryId(), 0).Pack());
    EXPECT_EQ(flat->tables()->Get(0)->flat_parent_idx(), 0);
    EXPECT_EQ(flat->tables()->Get(1)->flat_parent_idx(), 0);
    EXPECT_EQ(flat->tables()->Get(0)->flat_entry_idx(), 0);
    EXPECT_EQ(flat->tables()->Get(1)->flat_entry_idx(), 1);
}

TEST(UnificationTest, MultipleTablesInMultipleSchemas) {
    Catalog catalog;

    Script schema0{catalog};
    Script schema1{catalog};
    schema0.InsertTextAt(0, "create table in_default_0(a int);");
    schema1.InsertTextAt(0, "create table in_default_1(a int); create table separate.schema.in_separate_0(b int);");

    ASSERT_NO_THROW(schema0.Analyze());
    ASSERT_NO_THROW(catalog.LoadScript(schema0, 1));

    ASSERT_NO_THROW(schema1.Analyze());
    ASSERT_NO_THROW(catalog.LoadScript(schema1, 2));

    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(catalog.Flatten(fb));
    auto flat = flatbuffers::GetRoot<buffers::catalog::FlatCatalog>(fb.GetBufferPointer());

    // "in_default_0" should get expanded to dashql.default.in_default_0
    // "in_default_1" should get expanded to dashql.default.in_default_1
    // "separate.schema.in_separate_0" should reside in a separate schema

    // Note that these expectations are based on lexicograhical order
    // "dashql" < "separate"

    ASSERT_EQ(flat->databases()->size(), 2);
    ASSERT_EQ(flat->schemas()->size(), 2);
    ASSERT_EQ(flat->tables()->size(), 3);
    ASSERT_EQ(flat->columns()->size(), 3);

    EXPECT_EQ(flat->databases()->Get(0)->catalog_object_id(), INITIAL_DATABASE_ID);      // "dashql"
    EXPECT_EQ(flat->databases()->Get(1)->catalog_object_id(), INITIAL_DATABASE_ID + 1);  // "separate"
    EXPECT_EQ(flat->schemas()->Get(0)->catalog_object_id(), INITIAL_SCHEMA_ID);          // "default"
    EXPECT_EQ(flat->schemas()->Get(1)->catalog_object_id(), INITIAL_SCHEMA_ID + 1);      // "schema"

    // dashql.default.in_default_0 < dashql.default.in_default_1
    EXPECT_EQ(flat->tables()->Get(0)->catalog_object_id(), ExternalObjectID(schema0.GetCatalogEntryId(), 0).Pack());
    EXPECT_EQ(flat->tables()->Get(1)->catalog_object_id(), ExternalObjectID(schema1.GetCatalogEntryId(), 0).Pack());
    EXPECT_EQ(flat->tables()->Get(0)->flat_parent_idx(), 0);
    EXPECT_EQ(flat->tables()->Get(1)->flat_parent_idx(), 0);
    // separate.schema.in_separate_0 is written last
    EXPECT_EQ(flat->tables()->Get(2)->catalog_object_id(), ExternalObjectID(schema1.GetCatalogEntryId(), 1).Pack());
    EXPECT_EQ(flat->tables()->Get(2)->flat_parent_idx(), 1);
}

TEST(UnificationTest, SimpleTableReference) {
    Catalog catalog;

    Script schema{catalog};
    Script query{catalog};
    schema.InsertTextAt(0, "create table db1.schema1.table1(a int);create table db2.schema2.table2(a int);");
    query.InsertTextAt(0, "select * from db2.schema2.table2");

    ASSERT_NO_THROW(schema.Analyze());
    ASSERT_NO_THROW(catalog.LoadScript(schema, 1));

    // Analyze query after loading the schema script in the catalog
    ASSERT_NO_THROW(query.Analyze());
    auto& analyzed = query.GetAnalyzedScript();

    // Check flattened catalog
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(catalog.Flatten(fb));
    auto flat = flatbuffers::GetRoot<buffers::catalog::FlatCatalog>(fb.GetBufferPointer());

    ASSERT_EQ(flat->databases()->size(), 2);
    ASSERT_EQ(flat->schemas()->size(), 2);
    ASSERT_EQ(flat->tables()->size(), 2);
    ASSERT_EQ(flat->columns()->size(), 2);

    ASSERT_EQ(flat->name_dictionary()->Get(flat->databases()->Get(0)->name_id())->string_view(), "db1");
    ASSERT_EQ(flat->name_dictionary()->Get(flat->databases()->Get(1)->name_id())->string_view(), "db2");
    ASSERT_EQ(flat->name_dictionary()->Get(flat->schemas()->Get(0)->name_id())->string_view(), "schema1");
    ASSERT_EQ(flat->name_dictionary()->Get(flat->schemas()->Get(1)->name_id())->string_view(), "schema2");

    EXPECT_EQ(flat->tables()->Get(0)->catalog_object_id(), ExternalObjectID(schema.GetCatalogEntryId(), 0).Pack());
    EXPECT_EQ(flat->tables()->Get(1)->catalog_object_id(), ExternalObjectID(schema.GetCatalogEntryId(), 1).Pack());

    // Check table reference
    ASSERT_EQ(analyzed->table_references.GetSize(), 1);
    ASSERT_TRUE(std::holds_alternative<AnalyzedScript::TableReference::RelationExpression>(
        analyzed->table_references[0].inner));
    auto& rel_expr = std::get<AnalyzedScript::TableReference::RelationExpression>(analyzed->table_references[0].inner);
    ASSERT_TRUE(rel_expr.resolved_table.has_value());
    auto& resolved = rel_expr.resolved_table.value();
    ASSERT_EQ(resolved.catalog_schema_id.UnpackSchemaID().first, flat->databases()->Get(1)->catalog_object_id());
    ASSERT_EQ(resolved.catalog_schema_id.UnpackSchemaID().second, flat->schemas()->Get(1)->catalog_object_id());
    ASSERT_EQ(resolved.catalog_table_id.UnpackTableID().Pack(), flat->tables()->Get(1)->catalog_object_id());
}

TEST(UnificationTest, ParallelDatabaseRegistration) {
    Catalog catalog;

    Script schema0{catalog};
    Script schema1{catalog};
    schema0.InsertTextAt(0, "create table db1.schema1.table1(a int);");
    schema1.InsertTextAt(0, "create table db1.schema2.table2(a int);");

    ASSERT_NO_THROW(schema0.Analyze());
    ASSERT_NO_THROW(schema1.Analyze());
    auto& analyzed0 = schema0.GetAnalyzedScript();
    auto& analyzed1 = schema1.GetAnalyzedScript();
    auto db0_iter = analyzed0->GetDatabasesByName().find("db1");
    auto db1_iter = analyzed1->GetDatabasesByName().find("db1");
    ASSERT_NE(db0_iter, analyzed0->GetDatabasesByName().end());
    ASSERT_NE(db1_iter, analyzed1->GetDatabasesByName().end());
    auto db_id = db0_iter->second.get().GetDatabaseID();
    EXPECT_EQ(db1_iter->second.get().GetDatabaseID(), db_id);

    ASSERT_NO_THROW(catalog.LoadScript(schema0, 1));
    ASSERT_NO_THROW(catalog.LoadScript(schema1, 2));
    ASSERT_EQ(catalog.GetDatabases().size(), 1);
    auto db_iter = catalog.GetDatabases().find("db1");
    ASSERT_NE(db_iter, catalog.GetDatabases().end());
    EXPECT_EQ(db_iter->second->GetDatabaseID(), db_id);
    EXPECT_EQ(catalog.GetSchemas().size(), 2);
    EXPECT_TRUE(catalog.Contains(schema0.GetCatalogEntryId()));
    EXPECT_TRUE(catalog.Contains(schema1.GetCatalogEntryId()));
}

TEST(UnificationTest, ParallelSchemaRegistration) {
    Catalog catalog;

    Script schema0{catalog};
    Script schema1{catalog};
    schema0.InsertTextAt(0, "create table schema1.table1(a int);");
    schema1.InsertTextAt(0, "create table schema1.table2(a int);");

    ASSERT_NO_THROW(schema0.Analyze());
    ASSERT_NO_THROW(schema1.Analyze());
    auto& analyzed0 = schema0.GetAnalyzedScript();
    auto& analyzed1 = schema1.GetAnalyzedScript();
    auto schema0_iter = analyzed0->GetSchemasByName().find({"", "schema1"});
    auto schema1_iter = analyzed1->GetSchemasByName().find({"", "schema1"});
    ASSERT_NE(schema0_iter, analyzed0->GetSchemasByName().end());
    ASSERT_NE(schema1_iter, analyzed1->GetSchemasByName().end());
    auto schema_id = schema0_iter->second.get().object_id;
    EXPECT_EQ(schema1_iter->second.get().object_id, schema_id);

    ASSERT_NO_THROW(catalog.LoadScript(schema0, 1));
    ASSERT_NO_THROW(catalog.LoadScript(schema1, 2));
    ASSERT_EQ(catalog.GetDatabases().size(), 1);
    ASSERT_EQ(catalog.GetSchemas().size(), 1);
    auto schema_iter = catalog.GetSchemas().find({"", "schema1"});
    ASSERT_NE(schema_iter, catalog.GetSchemas().end());
    EXPECT_EQ(schema_iter->second->object_id, schema_id);
    EXPECT_TRUE(catalog.Contains(schema0.GetCatalogEntryId()));
    EXPECT_TRUE(catalog.Contains(schema1.GetCatalogEntryId()));
}

TEST(UnificationTest, ConcurrentDeclarationAnalysisUsesCanonicalIds) {
    Catalog catalog;
    Script schema0{catalog};
    Script schema1{catalog};
    schema0.InsertTextAt(0, "create table db1.schema1.table1(a int);");
    schema1.InsertTextAt(0, "create table db1.schema1.table2(b int);");
    ASSERT_NO_THROW(schema0.Parse());
    ASSERT_NO_THROW(schema1.Parse());

    std::barrier start{3};
    std::exception_ptr errors[2];
    std::thread threads[] = {
        std::thread{[&] {
            start.arrive_and_wait();
            try {
                schema0.Analyze(false);
            } catch (...) {
                errors[0] = std::current_exception();
            }
        }},
        std::thread{[&] {
            start.arrive_and_wait();
            try {
                schema1.Analyze(false);
            } catch (...) {
                errors[1] = std::current_exception();
            }
        }},
    };
    start.arrive_and_wait();
    for (auto& thread : threads) {
        thread.join();
    }
    ASSERT_EQ(errors[0], nullptr);
    ASSERT_EQ(errors[1], nullptr);

    auto& analyzed0 = schema0.GetAnalyzedScript();
    auto& analyzed1 = schema1.GetAnalyzedScript();
    ASSERT_NE(analyzed0, nullptr);
    ASSERT_NE(analyzed1, nullptr);
    auto db0 = analyzed0->GetDatabasesByName().find("db1");
    auto db1 = analyzed1->GetDatabasesByName().find("db1");
    ASSERT_NE(db0, analyzed0->GetDatabasesByName().end());
    ASSERT_NE(db1, analyzed1->GetDatabasesByName().end());
    EXPECT_EQ(db0->second.get().object_id, db1->second.get().object_id);
    auto schema0_iter = analyzed0->GetSchemasByName().find({"db1", "schema1"});
    auto schema1_iter = analyzed1->GetSchemasByName().find({"db1", "schema1"});
    ASSERT_NE(schema0_iter, analyzed0->GetSchemasByName().end());
    ASSERT_NE(schema1_iter, analyzed1->GetSchemasByName().end());
    EXPECT_EQ(schema0_iter->second.get().object_id, schema1_iter->second.get().object_id);

    ASSERT_NO_THROW(catalog.LoadScript(schema0, 1));
    ASSERT_NO_THROW(catalog.LoadScript(schema1, 2));
    EXPECT_TRUE(catalog.Contains(schema0.GetCatalogEntryId()));
    EXPECT_TRUE(catalog.Contains(schema1.GetCatalogEntryId()));

    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(catalog.Flatten(fb));
    auto flat = flatbuffers::GetRoot<buffers::catalog::FlatCatalog>(fb.GetBufferPointer());
    ASSERT_EQ(flat->databases()->size(), 1);
    ASSERT_EQ(flat->schemas()->size(), 1);
    ASSERT_EQ(flat->tables()->size(), 2);
    EXPECT_NE(flat->tables()->Get(0)->catalog_object_id(), flat->tables()->Get(1)->catalog_object_id());
}

TEST(UnificationTest, ConcurrentScriptConstructionAllocatesUniqueEntryIds) {
    Catalog catalog;
    constexpr size_t thread_count = 8;
    constexpr size_t scripts_per_thread = 128;
    std::vector<std::vector<CatalogEntryID>> ids(thread_count);
    std::vector<std::thread> threads;
    threads.reserve(thread_count);

    for (size_t thread_id = 0; thread_id < thread_count; ++thread_id) {
        threads.emplace_back([&catalog, &ids, thread_id] {
            ids[thread_id].reserve(scripts_per_thread);
            for (size_t i = 0; i < scripts_per_thread; ++i) {
                Script script{catalog};
                ids[thread_id].push_back(script.GetCatalogEntryId());
            }
        });
    }
    for (auto& thread : threads) {
        thread.join();
    }

    std::unordered_set<CatalogEntryID> unique_ids;
    for (auto& thread_ids : ids) {
        unique_ids.insert(thread_ids.begin(), thread_ids.end());
    }
    EXPECT_EQ(unique_ids.size(), thread_count * scripts_per_thread);
    EXPECT_EQ(*std::min_element(unique_ids.begin(), unique_ids.end()), INITIAL_ENTRY_ID);
    EXPECT_EQ(*std::max_element(unique_ids.begin(), unique_ids.end()),
              INITIAL_ENTRY_ID + thread_count * scripts_per_thread - 1);
}

}  // namespace
