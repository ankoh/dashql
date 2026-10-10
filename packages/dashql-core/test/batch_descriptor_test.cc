#include "dashql/batch.h"

#include <flatbuffers/verifier.h>

#include <algorithm>
#include <stdexcept>

#include "dashql/analyzer/completion.h"
#include "dashql/api.h"
#include "dashql/catalog_descriptor.h"
#include "dashql/exception.h"
#include "dashql/script.h"
#include "gtest/gtest.h"

using namespace dashql;

namespace {

std::vector<uint8_t> Descriptor(std::string_view sql) {
    Catalog producer;
    Script script{producer};
    script.ReplaceText(sql);
    script.Analyze();
    EXPECT_TRUE(script.scanned_script->errors.empty());
    EXPECT_TRUE(script.parsed_script->errors.empty());
    EXPECT_TRUE(script.analyzed_script->errors.empty());
    auto buffer = PackCatalogDescriptor(*script.analyzed_script);
    return {buffer.data(), buffer.data() + buffer.size()};
}

void Replace(Catalog& catalog, CatalogEntryID id, std::span<const uint8_t> descriptor, uint32_t rank = 0) {
    catalog.ReplaceDescriptor(id, rank, descriptor);
}

flatbuffers::DetachedBuffer Request(const buffers::batch::BatchRequestT& request) {
    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(buffers::batch::BatchRequest::Pack(builder, &request));
    return builder.Release();
}

void AddInput(buffers::batch::BatchRequestT& request, std::string id, std::string text, uint32_t outputs) {
    auto input = std::make_unique<buffers::batch::BatchScriptInputT>();
    input->id = std::move(id);
    input->text = std::move(text);
    input->outputs = outputs;
    request.scripts.push_back(std::move(input));
}

flatbuffers::DetachedBuffer RunBatch(const buffers::batch::BatchRequestT& request) {
    auto input = Request(request);
    return ProcessBatch({input.data(), input.size()});
}

template <typename T> const T* VerifyNested(const flatbuffers::Vector<uint8_t>* bytes) {
    if (!bytes || bytes->size() == 0) {
        ADD_FAILURE() << "missing nested output";
        return nullptr;
    }
    flatbuffers::Verifier verifier{bytes->data(), bytes->size()};
    EXPECT_TRUE(verifier.VerifyBuffer<T>(nullptr));
    return flatbuffers::GetRoot<T>(bytes->data());
}

bool HasCandidate(const Completion& completion, std::string_view name) {
    auto& candidates = completion.GetResultCandidates();
    return std::any_of(candidates.begin(), candidates.end(),
                       [&](auto& candidate) { return candidate.completion_text == name; });
}

TEST(DescriptorTest, RoundTripRemapsWorkerIdsAndOwnsStrings) {
    auto bytes = Descriptor("create table db.sch.items(id int, title text); "
                            "create function db.sch.item_count(input int) returns bigint;");
    Catalog receiver;
    receiver.ReserveDatabaseId("different");
    auto id = receiver.AllocateEntryId();
    auto descriptor_id = receiver.AllocateEntryId();
    EXPECT_NE(id, descriptor_id);
    Replace(receiver, descriptor_id, bytes, 20);
    std::fill(bytes.begin(), bytes.end(), 0);

    receiver.Iterate([&](auto entry_id, auto& entry) {
        EXPECT_EQ(entry_id, descriptor_id);
        ASSERT_EQ(entry.GetTables().GetSize(), 1);
        auto& table = entry.GetTables()[0];
        EXPECT_EQ(entry.GetCatalogVersion(), receiver.GetVersion());
        EXPECT_EQ(table.catalog_version, receiver.GetVersion());
        EXPECT_EQ(table.GetTableID(), CatalogTableID(descriptor_id, 0));
        EXPECT_EQ(table.catalog_schema_id.UnpackSchemaID().first, INITIAL_DATABASE_ID + 1);
        EXPECT_FALSE(table.ast_node_id.has_value());
        ASSERT_EQ(table.table_columns.size(), 2);
        EXPECT_TRUE(table.table_columns_by_name.contains("id"));
        ASSERT_EQ(entry.GetFunctions().GetSize(), 1);
        auto& function = entry.GetFunctions()[0];
        EXPECT_EQ(function.GetFunctionID(), CatalogFunctionID(descriptor_id, 0));
        EXPECT_EQ(function.return_type, "bigint");
        ASSERT_EQ(function.params.size(), 1);
        EXPECT_EQ(function.params[0].param_name.get().text, "input");
        EXPECT_EQ(function.params[0].param_type, "int");
        auto roundtrip = PackCatalogDescriptor(entry);
        EXPECT_NO_THROW(DescriptorPool({roundtrip.data(), roundtrip.size()}));
    });

    Script query{receiver};
    query.ReplaceText("select id from db.sch.items");
    query.Analyze();
    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(query.analyzed_script->Pack(builder));
    auto* analyzed = flatbuffers::GetRoot<buffers::analyzer::AnalyzedScript>(builder.GetBufferPointer());
    ASSERT_EQ(analyzed->table_references()->size(), 1);
    auto* resolved = analyzed->table_references()->Get(0)->resolved_table();
    ASSERT_NE(resolved, nullptr);
    EXPECT_EQ(resolved->catalog_table_id(), CatalogTableID(descriptor_id, 0).Pack());
    EXPECT_EQ(analyzed->resolved_column_references_by_id()->size(), 1);
    EXPECT_EQ(receiver.ResolveTable(CatalogTableID(descriptor_id, 99)), nullptr);
}

TEST(DescriptorTest, CompletionIncludesTablesColumnsFunctionsAndQualifiedPaths) {
    auto bytes = Descriptor("create table db.sch.items(id int, title text); "
                            "create function db.sch.item_count(input int) returns bigint;");
    Catalog receiver;
    Replace(receiver, receiver.AllocateEntryId(), bytes);
    for (auto [text, expected] : {
             std::pair{"select * from ite", "items"},
             std::pair{"select item_c", "item_count"},
             std::pair{"select tit", "title"},
             std::pair{"select * from db.sch.", "items"},
             std::pair{"select * from db.sch.items i where i.", "id"},
         }) {
        Script script{receiver};
        script.ReplaceText(text);
        script.Analyze();
        script.MoveCursor(std::string_view{text}.size());
        auto completion = script.CompleteAtCursor(50);
        EXPECT_TRUE(HasCandidate(*completion, expected)) << text;
    }
}

TEST(DescriptorTest, UnicodeNamespacesResolveAndCompleteLocallyAndThroughCatalog) {
    const std::string database = "\xc3\xa9";
    const std::string schema = "\xe6\xa8\xa1";
    const std::string ddl = "create table \"" + database + "\".\"" + schema + "\".items(id int)";
    Catalog catalog;
    Script local{catalog};
    local.ReplaceText(ddl + "; select id from \"" + schema + "\".items");
    local.Analyze();
    auto check_resolution = [](Script& script) {
        ASSERT_EQ(script.analyzed_script->table_references.GetSize(), 1);
        auto& relation = std::get<TableReference::RelationExpression>(script.analyzed_script->table_references[0].inner);
        EXPECT_TRUE(relation.resolved_table.has_value());
    };
    check_resolution(local);
    auto check_namespaces = [&](Script& script) {
        std::vector<std::pair<std::reference_wrapper<const CatalogEntry::SchemaReference>, bool>> schemas;
        script.analyzed_script->ResolveDatabaseSchemasWithCatalog(database, schemas);
        ASSERT_EQ(schemas.size(), 1);
        EXPECT_EQ(schemas[0].first.get().schema_name, schema);
        std::vector<std::pair<std::reference_wrapper<const CatalogEntry::TableDeclaration>, bool>> tables;
        script.analyzed_script->ResolveSchemaTablesWithCatalog(schema, tables);
        ASSERT_EQ(tables.size(), 1);
        EXPECT_EQ(tables[0].first.get().table_name.table_name.get().text, "items");
    };
    check_namespaces(local);
    local.ReplaceText(ddl + "; select * from \"" + schema + "\".");
    local.Analyze();
    local.MoveCursor(local.ToString().size());
    EXPECT_TRUE(HasCandidate(*local.CompleteAtCursor(50), "items"));

    auto bytes = Descriptor(ddl);
    Replace(catalog, catalog.AllocateEntryId(), bytes);
    Script query{catalog};
    query.ReplaceText("select id from \"" + schema + "\".items");
    query.Analyze();
    check_resolution(query);
    check_namespaces(query);
    for (auto [text, expected] : {std::pair{"select * from \"" + database + "\".", schema},
                                  std::pair{"select * from \"" + schema + "\".", std::string{"items"}}}) {
        query.ReplaceText(text);
        query.Analyze();
        query.MoveCursor(text.size());
        EXPECT_TRUE(HasCandidate(*query.CompleteAtCursor(50), expected)) << text;
    }
}

TEST(DescriptorTest, ProducerRejectsDeclarationsThatImporterWouldReject) {
    for (auto sql : {"create table items(id int); create table items(title text)",
                     "create table items(id int, id text)",
                     "create table items(id, id) as select 1 as first, 2 as second"}) {
        Catalog catalog;
        Script script{catalog};
        script.ReplaceText(sql);
        script.Analyze();
        ASSERT_TRUE(script.parsed_script->errors.empty()) << sql;
        EXPECT_THROW(PackCatalogDescriptor(*script.analyzed_script), std::invalid_argument) << sql;
    }
}

TEST(DescriptorTest, SinglePoolReplacementPreservesMixedEntriesOnBadInputs) {
    auto first = Descriptor("create table db.sch.original(id int);");
    auto second = Descriptor("create table db.sch.updated(id int);");
    Catalog catalog;
    auto id = catalog.AllocateEntryId();
    Replace(catalog, id, first, 20);
    Script script{catalog};
    script.ReplaceText("create table db.sch.script_table(id int)");
    script.Analyze();
    catalog.LoadScript(script, 10);
    EXPECT_TRUE(catalog.Contains(id));
    auto version = catalog.GetVersion();
    auto other = catalog.AllocateEntryId();
    const uint8_t invalid[] = {0, 1, 2, 3};
    auto* original = catalog.ResolveTable(CatalogTableID(id, 0));
    auto* script_table = catalog.ResolveTable(CatalogTableID(script.GetCatalogEntryId(), 0));
    EXPECT_THROW(Replace(catalog, id, invalid, 1), std::invalid_argument);
    EXPECT_THROW(Replace(catalog, other, invalid, 2), std::invalid_argument);
    EXPECT_THROW(Replace(catalog, id, {}, 1), std::invalid_argument);
    EXPECT_EQ(catalog.GetVersion(), version);
    ASSERT_NE(catalog.ResolveTable(CatalogTableID(id, 0)), nullptr);
    EXPECT_EQ(catalog.ResolveTable(CatalogTableID(id, 0))->table_name.table_name.get().text, "original");
    EXPECT_FALSE(catalog.Contains(other));
    EXPECT_EQ(catalog.ResolveTable(CatalogTableID(id, 0)), original);
    EXPECT_EQ(catalog.ResolveTable(CatalogTableID(script.GetCatalogEntryId(), 0)), script_table);
    EXPECT_THROW(Replace(catalog, script.GetCatalogEntryId(), second), std::invalid_argument);
    EXPECT_THROW(Replace(catalog, UINT32_MAX, second), std::invalid_argument);
    EXPECT_EQ(catalog.GetVersion(), version);
    Replace(catalog, id, second, 1);
    EXPECT_EQ(catalog.GetVersion(), version + 1);
    EXPECT_THROW(Replace(catalog, other, invalid, 2), std::invalid_argument);
    EXPECT_EQ(catalog.GetVersion(), version + 1);
    EXPECT_EQ(catalog.ResolveTable(CatalogTableID(id, 0))->table_name.table_name.get().text, "updated");
    EXPECT_FALSE(catalog.Contains(other));
    EXPECT_EQ(catalog.ResolveTable(CatalogTableID(script.GetCatalogEntryId(), 0)), script_table);
    Replace(catalog, other, first, 2);
    EXPECT_EQ(catalog.GetVersion(), version + 2);
    EXPECT_TRUE(catalog.Contains(script.GetCatalogEntryId()));
    EXPECT_TRUE(catalog.Contains(other));
    EXPECT_EQ(catalog.ResolveTable(CatalogTableID(id, 0))->table_name.table_name.get().text, "updated");
    catalog.DropDescriptor(id);
    EXPECT_FALSE(catalog.Contains(id));
    EXPECT_TRUE(catalog.Contains(other));
    EXPECT_TRUE(catalog.Contains(script.GetCatalogEntryId()));
}

TEST(DescriptorTest, SecondPoolFailureRetainsFirstSuccessfulReplacementAndSecondOldPool) {
    auto old_descriptor = Descriptor("create table db.sch.old_table(id int)");
    auto new_descriptor = Descriptor("create table db.sch.new_table(id int)");
    Catalog catalog;
    auto first = catalog.AllocateEntryId();
    auto second = catalog.AllocateEntryId();
    Replace(catalog, first, old_descriptor, 10);
    Replace(catalog, second, old_descriptor, 20);
    auto* second_old_table = catalog.ResolveTable(CatalogTableID(second, 0));
    auto version = catalog.GetVersion();

    Replace(catalog, first, new_descriptor, 1);
    const uint8_t invalid[] = {0, 1, 2, 3};
    EXPECT_THROW(Replace(catalog, second, invalid, 2), std::invalid_argument);
    EXPECT_EQ(catalog.GetVersion(), version + 1);
    ASSERT_NE(catalog.ResolveTable(CatalogTableID(first, 0)), nullptr);
    EXPECT_EQ(catalog.ResolveTable(CatalogTableID(first, 0))->table_name.table_name.get().text, "new_table");
    EXPECT_EQ(catalog.ResolveTable(CatalogTableID(second, 0)), second_old_table);
    catalog.IterateRanked([&](auto id, auto& entry, auto rank) {
        EXPECT_EQ(rank, id == first ? 1 : 20);
        EXPECT_EQ(entry.GetCatalogVersion(), id == first ? version + 1 : version);
    });

    Replace(catalog, second, new_descriptor, 2);
    EXPECT_EQ(catalog.GetVersion(), version + 2);
    catalog.IterateRanked([&](auto id, auto& entry, auto rank) {
        EXPECT_EQ(rank, id == first ? 1 : 2);
        EXPECT_EQ(entry.GetCatalogVersion(), id == first ? version + 1 : version + 2);
    });
}

TEST(DescriptorTest, ReplacedEntriesAndNamespaceOwnersLiveUntilAnalysisReleased) {
    auto old_descriptor = Descriptor("create table db.sch.items(old_column int)");
    auto new_descriptor = Descriptor("create table db.sch.items(new_column int)");
    Catalog catalog;
    auto id = catalog.AllocateEntryId();
    Replace(catalog, id, old_descriptor);
    auto old_database = std::weak_ptr{catalog.GetDatabases().begin()->second};
    auto old_schema = std::weak_ptr{catalog.GetSchemas().begin()->second};
    Script query{catalog};
    query.ReplaceText("select old_column from db.sch.items");
    query.Analyze();
    auto retained = query.analyzed_script;
    Replace(catalog, id, new_descriptor);
    catalog.Clear();
    EXPECT_FALSE(old_database.expired());
    EXPECT_FALSE(old_schema.expired());
    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(retained->Pack(builder));
    flatbuffers::Verifier verifier{builder.GetBufferPointer(), builder.GetSize()};
    EXPECT_TRUE(verifier.VerifyBuffer<buffers::analyzer::AnalyzedScript>(nullptr));
    auto* result = flatbuffers::GetRoot<buffers::analyzer::AnalyzedScript>(builder.GetBufferPointer());
    EXPECT_EQ(result->resolved_column_references_by_id()->size(), 1);
    retained.reset();
    query.analyzed_script.reset();
    EXPECT_TRUE(old_schema.expired());
    EXPECT_TRUE(old_database.expired());
}

TEST(DescriptorTest, SemanticValidationRejectsMissingNestedNamesAndDuplicates) {
    buffers::catalog::CatalogDescriptorT descriptor;
    descriptor.tables.push_back(std::make_unique<buffers::analyzer::TableT>());
    auto validate = [&] {
        flatbuffers::FlatBufferBuilder builder;
        builder.Finish(buffers::catalog::CatalogDescriptor::Pack(builder, &descriptor));
        DescriptorPool pool{{builder.GetBufferPointer(), builder.GetSize()}};
    };
    EXPECT_THROW(validate(), std::invalid_argument);
    auto& table = *descriptor.tables[0];
    table.table_name = std::make_unique<buffers::analyzer::QualifiedTableNameT>();
    EXPECT_THROW(validate(), std::invalid_argument);
    table.table_name->table_name = "items";
    EXPECT_NO_THROW(validate());
    table.table_columns.push_back(std::make_unique<buffers::analyzer::TableColumnT>());
    EXPECT_THROW(validate(), std::invalid_argument);
    table.table_columns[0]->column_name = "id";
    table.table_columns.push_back(std::make_unique<buffers::analyzer::TableColumnT>(*table.table_columns[0]));
    EXPECT_THROW(validate(), std::invalid_argument);
    table.table_columns.pop_back();
    descriptor.tables.push_back(std::make_unique<buffers::analyzer::TableT>(table));
    EXPECT_THROW(validate(), std::invalid_argument);
    descriptor.tables.pop_back();
    descriptor.function_declarations.push_back(std::make_unique<buffers::analyzer::FunctionDeclarationT>());
    EXPECT_THROW(validate(), std::invalid_argument);
    auto& function = *descriptor.function_declarations[0];
    function.function_name = std::make_unique<buffers::analyzer::QualifiedFunctionNameT>();
    function.function_name->function_name = "count_items";
    EXPECT_THROW(validate(), std::invalid_argument);
    function.return_type = "int";
    function.params.push_back(std::make_unique<buffers::analyzer::FunctionParamT>());
    EXPECT_THROW(validate(), std::invalid_argument);
    function.params[0]->param_type = "int";
    EXPECT_NO_THROW(validate());
}

TEST(DescriptorTest, ImportsFunctionOverloadsWithoutLosingCompletionObjects) {
    auto bytes = Descriptor("create function db.sch.overloaded(arg int) returns int; "
                            "create function db.sch.overloaded(arg text) returns text;");
    Catalog catalog;
    auto id = catalog.AllocateEntryId();
    Replace(catalog, id, bytes);
    catalog.Iterate([&](auto, auto& entry) {
        ASSERT_EQ(entry.GetFunctions().GetSize(), 2);
        EXPECT_EQ(entry.GetFunctions()[0].params[0].param_type, "int");
        EXPECT_EQ(entry.GetFunctions()[1].params[0].param_type, "text");
        EXPECT_EQ(entry.GetFunctions()[1].GetFunctionID(), CatalogFunctionID(id, 1));
        auto roundtrip = PackCatalogDescriptor(entry);
        auto* descriptor = flatbuffers::GetRoot<buffers::catalog::CatalogDescriptor>(roundtrip.data());
        ASSERT_EQ(descriptor->function_declarations()->size(), 2);
    });
    Script query{catalog};
    query.ReplaceText("select overloa");
    query.Analyze();
    query.MoveCursor(query.ToString().size());
    auto completion = query.CompleteAtCursor(50);
    bool found = false;
    for (auto& candidate : completion->GetResultCandidates()) {
        if (candidate.completion_text != "overloaded") continue;
        found = true;
        EXPECT_EQ(candidate.catalog_objects.GetSize(), 2);
    }
    EXPECT_TRUE(found);
}

TEST(DescriptorTest, BuildsSuffixIndexOnlyOnDemand) {
    auto bytes = Descriptor("create table items(id int)");
    Catalog catalog;
    auto pool = std::make_shared<DescriptorPool>(bytes);
    DescriptorEntry entry{catalog, catalog.AllocateEntryId(), 0, std::move(pool)};
    auto inspect = [](CatalogEntry& value) {
        struct Access : CatalogEntry {
            static bool Built(CatalogEntry& value) {
                auto member = &Access::name_search_index;
                return (value.*member).has_value();
            }
        };
        return Access::Built(value);
    };
    EXPECT_FALSE(inspect(entry));
    auto descriptor = PackCatalogDescriptor(entry);
    EXPECT_FALSE(inspect(entry));
    auto& index = entry.GetNameSearchIndex();
    EXPECT_TRUE(inspect(entry));
    EXPECT_GT(index.size(), 0);
    EXPECT_EQ(&entry.GetNameSearchIndex(), &index);
}

TEST(DescriptorTest, ValidatesUtf8InEveryNestedStringUsingBoundedLengths) {
    buffers::catalog::CatalogDescriptorT descriptor;
    auto table = std::make_unique<buffers::analyzer::TableT>();
    table->table_name = std::make_unique<buffers::analyzer::QualifiedTableNameT>();
    table->table_name->database_name = "db";
    table->table_name->schema_name = "sch";
    table->table_name->table_name = "items";
    auto column = std::make_unique<buffers::analyzer::TableColumnT>();
    column->column_name = "id";
    table->table_columns.push_back(std::move(column));
    descriptor.tables.push_back(std::move(table));
    auto function = std::make_unique<buffers::analyzer::FunctionDeclarationT>();
    function->function_name = std::make_unique<buffers::analyzer::QualifiedFunctionNameT>();
    function->function_name->database_name = "db";
    function->function_name->schema_name = "sch";
    function->function_name->function_name = "overloaded";
    function->return_type = "int";
    auto param = std::make_unique<buffers::analyzer::FunctionParamT>();
    param->param_name = "arg";
    param->param_type = "int";
    function->params.push_back(std::move(param));
    descriptor.function_declarations.push_back(std::move(function));
    auto validate = [&] {
        flatbuffers::FlatBufferBuilder builder;
        builder.Finish(buffers::catalog::CatalogDescriptor::Pack(builder, &descriptor));
        DescriptorPool pool{{builder.GetBufferPointer(), builder.GetSize()}};
    };
    auto& t = *descriptor.tables[0];
    auto& f = *descriptor.function_declarations[0];
    for (auto* field : {&t.table_name->database_name, &t.table_name->schema_name, &t.table_name->table_name,
                       &t.table_columns[0]->column_name, &f.function_name->database_name,
                       &f.function_name->schema_name, &f.function_name->function_name,
                       &f.return_type, &f.params[0]->param_name, &f.params[0]->param_type}) {
        auto original = *field;
        *field = std::string(4096, 'a') + "\xc3\xa9";
        EXPECT_NO_THROW(validate());
        // A truncated final codepoint must not consume bytes after the field.
        *field = std::string(4096, 'a') + "\xe2\x82";
        EXPECT_THROW(validate(), std::invalid_argument);
        *field = std::string(4096, 'a') + "\xed\xa0\x80";
        EXPECT_THROW(validate(), std::invalid_argument);
        *field = original;
    }
    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(buffers::catalog::CatalogDescriptor::Pack(builder, &descriptor));
    auto* root = flatbuffers::GetMutableRoot<buffers::catalog::CatalogDescriptor>(builder.GetBufferPointer());
    auto* name = root->mutable_tables()->GetMutableObject(0)->mutable_table_name()->mutable_table_name();
    flatbuffers::WriteScalar(reinterpret_cast<flatbuffers::uoffset_t*>(name),
                             static_cast<flatbuffers::uoffset_t>(builder.GetSize()));
    EXPECT_THROW(DescriptorPool({builder.GetBufferPointer(), builder.GetSize()}), std::invalid_argument);
}

TEST(CatalogLifetimeTest, RetainsOnlyReferencedScriptGenerations) {
    Catalog catalog;
    Script dependency{catalog};
    Script unrelated{catalog};
    dependency.ReplaceText("create table db.sch.items(id int)");
    unrelated.ReplaceText("create table other.sch.unrelated(id int)");
    dependency.Analyze();
    unrelated.Analyze();
    catalog.LoadScript(dependency, 0);
    catalog.LoadScript(unrelated, 1);
    auto unrelated_database = std::weak_ptr{catalog.GetDatabases().find("other")->second};
    auto unrelated_schema = std::weak_ptr{catalog.GetSchemas().find({"other", "sch"})->second};
    auto old_dependency = std::weak_ptr{dependency.analyzed_script};
    auto old_unrelated = std::weak_ptr{unrelated.analyzed_script};
    Script consumer{catalog};
    consumer.ReplaceText("select id from db.sch.items");
    consumer.Analyze();
    dependency.ReplaceText("create table db.sch.items(new_id int)");
    dependency.Analyze();
    catalog.LoadScript(dependency, 0);
    EXPECT_TRUE(unrelated_database.expired());
    EXPECT_TRUE(unrelated_schema.expired());
    catalog.DropScript(unrelated);
    unrelated.analyzed_script.reset();
    EXPECT_TRUE(old_unrelated.expired());
    EXPECT_FALSE(old_dependency.expired());
    catalog.Clear();
    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(consumer.analyzed_script->Pack(builder));
    auto* result = flatbuffers::GetRoot<buffers::analyzer::AnalyzedScript>(builder.GetBufferPointer());
    EXPECT_EQ(result->resolved_column_references_by_id()->size(), 1);
    consumer.analyzed_script.reset();
    EXPECT_TRUE(old_dependency.expired());
}

TEST(CatalogLifetimeTest, RetainsAmbiguousAlternativesStarColumnsAndInsertTargets) {
    Catalog catalog;
    auto first = std::make_unique<Script>(catalog);
    auto second = std::make_unique<Script>(catalog);
    first->ReplaceText("create table db.first.items(id int)");
    second->ReplaceText("create table db.second.items(id int)");
    first->Analyze();
    second->Analyze();
    catalog.LoadScript(*first, 0);
    catalog.LoadScript(*second, 1);
    auto old_first = std::weak_ptr{first->analyzed_script};
    auto old_second = std::weak_ptr{second->analyzed_script};
    Script consumer{catalog};
    consumer.ReplaceText("select * from items; insert into db.first.items(id) values (1)");
    consumer.Analyze();
    auto& relation = std::get<TableReference::RelationExpression>(consumer.analyzed_script->table_references[0].inner);
    ASSERT_EQ(relation.resolved_alternatives.size(), 1);
    first.reset();
    second.reset();
    catalog.Clear();
    EXPECT_FALSE(old_first.expired());
    EXPECT_FALSE(old_second.expired());
    consumer.MoveCursor(consumer.ToString().find("items") + 5);
    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(consumer.analyzed_script->Pack(builder));
    auto* packed = flatbuffers::GetRoot<buffers::analyzer::AnalyzedScript>(builder.GetBufferPointer());
    ASSERT_EQ(packed->insert_statements()->size(), 1);
    EXPECT_NE(packed->insert_statements()->Get(0)->target_columns()->Get(0)->resolved_column(), nullptr);
    consumer.cursor.reset();
    consumer.analyzed_script.reset();
    EXPECT_TRUE(old_first.expired());
    EXPECT_TRUE(old_second.expired());
}

TEST(CatalogLifetimeTest, OwnPublicationDoesNotRetainPreviousGeneration) {
    Catalog catalog;
    Script script{catalog};
    script.ReplaceText("create table items(id int); select id from items");
    script.Analyze();
    catalog.LoadScript(script, 0);
    for (size_t i = 0; i < 4; ++i) {
        auto previous = std::weak_ptr{script.analyzed_script};
        script.Analyze(false);
        EXPECT_FALSE(previous.expired());
        catalog.LoadScript(script, 0);
        EXPECT_TRUE(previous.expired());
    }
    auto previous = std::weak_ptr{script.analyzed_script};
    script.ReplaceText("select id from items");
    script.Analyze();
    auto& relation = std::get<TableReference::RelationExpression>(script.analyzed_script->table_references[0].inner);
    EXPECT_FALSE(relation.resolved_table.has_value());
    catalog.LoadScript(script, 0);
    EXPECT_TRUE(previous.expired());
}

TEST(CatalogLifetimeTest, ScriptRemovalPrunesOnlyUnreferencedNamespacesAndPreservesLeases) {
    for (bool destroy : {false, true}) {
        Catalog catalog;
        auto bytes = Descriptor("create function shared.kept.f(arg int) returns int");
        auto descriptor_id = catalog.AllocateEntryId();
        Replace(catalog, descriptor_id, bytes);
        auto source = std::make_unique<Script>(catalog);
        source->ReplaceText("create table shared.kept.items(id int); create table shared.removed.items(id int); "
                            "create table removed.sch.items(id int)");
        source->Analyze();
        catalog.LoadScript(*source, 0);
        auto old_database = std::weak_ptr{catalog.GetDatabases().find("removed")->second};
        auto old_schema = std::weak_ptr{catalog.GetSchemas().find({"removed", "sch"})->second};
        auto old_graph = std::weak_ptr{source->analyzed_script};
        auto database_id = catalog.GetDatabases().find("removed")->second->object_id;
        auto schema_id = catalog.GetSchemas().find({"removed", "sch"})->second->object_id;
        Script consumer{catalog};
        consumer.ReplaceText("select id from removed.sch.items");
        consumer.Analyze();
        auto version = catalog.GetVersion();
        auto source_id = source->GetCatalogEntryId();
        if (destroy) source.reset();
        else catalog.DropScript(*source);
        EXPECT_EQ(catalog.GetVersion(), version + 1);
        EXPECT_FALSE(catalog.Contains(source_id));
        EXPECT_TRUE(catalog.Contains(descriptor_id));
        ASSERT_EQ(catalog.GetDatabases().size(), 1);
        EXPECT_NE(catalog.GetDatabases().find("shared"), catalog.GetDatabases().end());
        ASSERT_EQ(catalog.GetSchemas().size(), 1);
        EXPECT_NE(catalog.GetSchemas().find({"shared", "kept"}), catalog.GetSchemas().end());
        EXPECT_FALSE(old_database.expired());
        EXPECT_FALSE(old_schema.expired());
        flatbuffers::FlatBufferBuilder builder;
        builder.Finish(consumer.analyzed_script->Pack(builder));
        auto* packed = flatbuffers::GetRoot<buffers::analyzer::AnalyzedScript>(builder.GetBufferPointer());
        EXPECT_EQ(packed->resolved_column_references_by_id()->size(), 1);
        source.reset();
        consumer.analyzed_script.reset();
        EXPECT_TRUE(old_graph.expired());
        EXPECT_TRUE(old_schema.expired());
        EXPECT_TRUE(old_database.expired());
        EXPECT_EQ(catalog.ReserveDatabaseId("removed"), database_id);
        EXPECT_EQ(catalog.ReserveSchemaId("removed", "sch", database_id), schema_id);
        catalog.DropDescriptor(descriptor_id);
        EXPECT_TRUE(catalog.GetSchemas().empty());
        EXPECT_TRUE(catalog.GetDatabases().empty());
    }
}

TEST(CatalogLifetimeTest, ReanalysisAfterDestroyedUnpublishedGraphDoesNotReuseIntrusiveLinks) {
    Catalog catalog;
    Script script{catalog};
    script.ReplaceText("create table items(id int); select id from items; select * from ite");
    script.Analyze();
    auto old_graph = std::weak_ptr{script.analyzed_script};
    auto old_scan = std::weak_ptr{script.scanned_script};
    script.analyzed_script.reset();
    ASSERT_TRUE(old_graph.expired());
    script.Analyze(false);
    EXPECT_TRUE(old_scan.expired());
    auto& name = script.scanned_script->name_registry.names_by_text.at("items").get();
    ASSERT_EQ(name.resolved_objects.GetSize(), 1);
    EXPECT_EQ(&*name.resolved_objects.begin(), &script.analyzed_script->GetTables()[0]);
    script.MoveCursor(script.ToString().size());
    EXPECT_TRUE(HasCandidate(*script.CompleteAtCursor(50), "items"));
    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(script.analyzed_script->Pack(builder));
    auto* packed = flatbuffers::GetRoot<buffers::analyzer::AnalyzedScript>(builder.GetBufferPointer());
    EXPECT_EQ(packed->resolved_column_references_by_id()->size(), 1);
}

TEST(CatalogLifetimeTest, ReanalysisDoesNotMutatePublishedNameGraphOrCompletion) {
    Catalog catalog;
    Script schema{catalog};
    schema.ReplaceText("create table items(id int, title text)");
    schema.Analyze();
    catalog.LoadScript(schema, 0);
    auto previous = schema.analyzed_script;
    auto* old_scan = previous->parsed_script->scanned_script.get();
    auto& old_name = old_scan->name_registry.names_by_text.at("items").get();
    auto* old_object = &*old_name.resolved_objects.begin();
    previous->GetNameSearchIndex();
    schema.Analyze(false);
    EXPECT_NE(schema.scanned_script.get(), old_scan);
    EXPECT_EQ(&*old_name.resolved_objects.begin(), old_object);
    EXPECT_EQ(old_object, &previous->GetTables()[0]);
    Script query{catalog};
    query.ReplaceText("select * from ite");
    query.Analyze();
    query.MoveCursor(query.ToString().size());
    EXPECT_TRUE(HasCandidate(*query.CompleteAtCursor(50), "items"));
    catalog.LoadScript(schema, 0);
    query.Analyze(false);
    query.MoveCursor(query.ToString().size());
    EXPECT_TRUE(HasCandidate(*query.CompleteAtCursor(50), "items"));
    auto published = schema.analyzed_script;
    auto* published_scan = published->parsed_script->scanned_script.get();
    schema.analyzed_script.reset();
    schema.Analyze(false);
    EXPECT_NE(schema.scanned_script.get(), published_scan);
    auto& published_name = published_scan->name_registry.names_by_text.at("items").get();
    EXPECT_EQ(&*published_name.resolved_objects.begin(), &published->GetTables()[0]);
}

TEST(CatalogLifetimeTest, AnalyzeFalseReanalysisUsesParsedSnapshotAndStillRejectsUnparsed) {
    Catalog catalog;
    Script script{catalog};
    EXPECT_THROW(script.Analyze(false), Exception);
    EXPECT_EQ(script.parsed_script, nullptr);
    script.ReplaceText("create table original(id int)");
    script.Analyze();
    auto previous = script.analyzed_script;
    script.ReplaceText("create table edited(id int)");
    script.Analyze(false);
    EXPECT_EQ(script.analyzed_script->GetTables()[0].table_name.table_name.get().text, "original");
    EXPECT_NE(script.parsed_script.get(), previous->parsed_script.get());
    script.Analyze();
    EXPECT_EQ(script.analyzed_script->GetTables()[0].table_name.table_name.get().text, "edited");
    script.parsed_script.reset();
    EXPECT_THROW(script.Analyze(false), Exception);
    EXPECT_EQ(script.parsed_script, nullptr);
}

TEST(BatchTest, InvalidUtf8BeyondRopeLeafIsPerInputFailureWithoutProcessing) {
    buffers::batch::BatchRequestT request;
    for (auto malformed : {"\x80", "\xc0\xaf", "\xe2\x82", "\xed\xa0\x80", "\xf4\x90\x80\x80"}) {
        AddInput(request, "bad", std::string(4096, ' ') + malformed, 15);
    }
    AddInput(request, "no-output", std::string(4096, ' ') + "\x80", 0);
    AddInput(request, "valid", "select 1 /*" + std::string(4096, 'a') + "\xc3\xa9*/", 15);
    auto bytes = RunBatch(request);
    auto* scripts = flatbuffers::GetRoot<buffers::batch::BatchResult>(bytes.data())->scripts();
    ASSERT_EQ(scripts->size(), 7);
    for (size_t i = 0; i < 6; ++i) {
        auto* result = scripts->Get(i);
        ASSERT_NE(result->failure(), nullptr);
        EXPECT_EQ(result->failure()->str(), "invalid UTF-8 batch script text");
        EXPECT_EQ(result->diagnostics(), nullptr);
        EXPECT_EQ(result->scanned(), nullptr);
        EXPECT_EQ(result->parsed(), nullptr);
        EXPECT_EQ(result->analyzed(), nullptr);
        EXPECT_EQ(result->catalog_descriptor(), nullptr);
    }
    auto* valid = scripts->Get(6);
    EXPECT_EQ(valid->failure(), nullptr);
    VerifyNested<buffers::parser::ScannedScript>(valid->scanned());
    VerifyNested<buffers::analyzer::AnalyzedScript>(valid->analyzed());
}

TEST(BatchTest, EveryOutputSubsetSerializesOnlySelectedBuffers) {
    buffers::batch::BatchRequestT request;
    for (uint32_t outputs = 0; outputs < 16; ++outputs) {
        AddInput(request, std::to_string(outputs), "create table items(id int)", outputs);
    }
    auto bytes = RunBatch(request);
    auto* result = flatbuffers::GetRoot<buffers::batch::BatchResult>(bytes.data());
    ASSERT_EQ(result->scripts()->size(), 16);
    for (uint32_t outputs = 0; outputs < 16; ++outputs) {
        auto* script = result->scripts()->Get(outputs);
        EXPECT_EQ(script->id()->str(), std::to_string(outputs));
        EXPECT_TRUE(!script->failure() || script->failure()->size() == 0);
        EXPECT_EQ(script->scanned() && script->scanned()->size() > 0, (outputs & 1) != 0);
        EXPECT_EQ(script->parsed() && script->parsed()->size() > 0, (outputs & 2) != 0);
        EXPECT_EQ(script->analyzed() && script->analyzed()->size() > 0, (outputs & 4) != 0);
        EXPECT_EQ(script->catalog_descriptor() && script->catalog_descriptor()->size() > 0, (outputs & 8) != 0);
        if (outputs & 1) VerifyNested<buffers::parser::ScannedScript>(script->scanned());
        if (outputs & 2) VerifyNested<buffers::parser::ParsedScript>(script->parsed());
        if (outputs & 4) VerifyNested<buffers::analyzer::AnalyzedScript>(script->analyzed());
        if (outputs & 8) {
            VerifyNested<buffers::catalog::CatalogDescriptor>(script->catalog_descriptor());
            EXPECT_NO_THROW(DescriptorPool({script->catalog_descriptor()->data(), script->catalog_descriptor()->size()}));
        }
    }
}

TEST(BatchTest, DiagnosticsIndependentOfBuffersAndInvalidMasksDoNotEraseResults) {
    buffers::batch::BatchRequestT request;
    AddInput(request, "scan", "select 'unterminated", 1);
    AddInput(request, "parse", "create table broken(", 8);
    AddInput(request, "analyze", "select * from a x, b x", 4);
    AddInput(request, "invalid", "select 1", 16);
    AddInput(request, "valid", "select 1", 2);
    auto bytes = RunBatch(request);
    auto* scripts = flatbuffers::GetRoot<buffers::batch::BatchResult>(bytes.data())->scripts();
    ASSERT_EQ(scripts->size(), 5);
    for (uint32_t i = 0; i < 3; ++i) {
        auto* script = scripts->Get(i);
        ASSERT_NE(script->diagnostics(), nullptr);
        ASSERT_GT(script->diagnostics()->size(), 0);
        EXPECT_TRUE(!script->failure() || script->failure()->size() == 0);
        bool found = false;
        for (auto* error : *script->diagnostics()) {
            found |= static_cast<uint32_t>(error->stage()) == i;
            EXPECT_NE(error->message(), nullptr);
        }
        EXPECT_TRUE(found);
    }
    EXPECT_TRUE(!scripts->Get(1)->catalog_descriptor() || scripts->Get(1)->catalog_descriptor()->size() == 0);
    EXPECT_TRUE(!scripts->Get(1)->parsed() || scripts->Get(1)->parsed()->size() == 0);
    ASSERT_NE(scripts->Get(3)->failure(), nullptr);
    EXPECT_GT(scripts->Get(3)->failure()->size(), 0);
    VerifyNested<buffers::parser::ParsedScript>(scripts->Get(4)->parsed());
}

TEST(BatchTest, DescriptorValidationFailuresPreserveStageOutputsAndOtherInputs) {
    buffers::batch::BatchRequestT request;
    AddInput(request, "tables", "create table items(id int); create table items(title text)", 15);
    AddInput(request, "columns", "create table items(id int, id text)", 15);
    AddInput(request, "derived", "create table items(id, id) as select 1 as first, 2 as second", 15);
    AddInput(request, "valid", "create table items(id int, title text)", 8);
    auto bytes = RunBatch(request);
    auto* scripts = flatbuffers::GetRoot<buffers::batch::BatchResult>(bytes.data())->scripts();
    ASSERT_EQ(scripts->size(), 4);
    for (uint32_t i = 0; i < 3; ++i) {
        auto* result = scripts->Get(i);
        ASSERT_NE(result->failure(), nullptr);
        EXPECT_EQ(result->failure()->str(),
                  i == 0 ? "duplicate descriptor table name" : "duplicate descriptor column name");
        EXPECT_EQ(result->catalog_descriptor(), nullptr);
        VerifyNested<buffers::parser::ScannedScript>(result->scanned());
        VerifyNested<buffers::parser::ParsedScript>(result->parsed());
        VerifyNested<buffers::analyzer::AnalyzedScript>(result->analyzed());
    }
    auto* valid = scripts->Get(3);
    EXPECT_EQ(valid->failure(), nullptr);
    ASSERT_NE(valid->catalog_descriptor(), nullptr);
    Catalog receiver;
    auto id = receiver.AllocateEntryId();
    EXPECT_NO_THROW(Replace(receiver, id, {valid->catalog_descriptor()->data(), valid->catalog_descriptor()->size()}));
    EXPECT_NE(receiver.ResolveTable(CatalogTableID(id, 0)), nullptr);
}

TEST(BatchTest, DescriptorContextResolvesNamesButInputsNeverPublishToEachOther) {
    buffers::batch::BatchRequestT request;
    auto context = std::make_unique<buffers::batch::DescriptorBufferT>();
    context->data = Descriptor("create table context_table(id int)");
    request.catalog_descriptors.push_back(std::move(context));
    auto other_context = std::make_unique<buffers::batch::DescriptorBufferT>();
    other_context->data = Descriptor("create table other_context_table(id int)");
    request.catalog_descriptors.push_back(std::move(other_context));
    AddInput(request, "producer", "create table local_table(id int)", 8);
    AddInput(request, "consumer", "select id from local_table", 4);
    AddInput(request, "context", "select id from context_table", 4);
    AddInput(request, "other-context", "select id from other_context_table", 4);
    auto bytes = RunBatch(request);
    auto* scripts = flatbuffers::GetRoot<buffers::batch::BatchResult>(bytes.data())->scripts();
    auto* consumer = VerifyNested<buffers::analyzer::AnalyzedScript>(scripts->Get(1)->analyzed());
    auto* contextual = VerifyNested<buffers::analyzer::AnalyzedScript>(scripts->Get(2)->analyzed());
    ASSERT_NE(consumer, nullptr);
    ASSERT_NE(contextual, nullptr);
    EXPECT_EQ(consumer->table_references()->Get(0)->resolved_table(), nullptr);
    EXPECT_NE(contextual->table_references()->Get(0)->resolved_table(), nullptr);
    auto* other_contextual = VerifyNested<buffers::analyzer::AnalyzedScript>(scripts->Get(3)->analyzed());
    ASSERT_NE(other_contextual, nullptr);
    EXPECT_NE(other_contextual->table_references()->Get(0)->resolved_table(), nullptr);
}

TEST(BatchTest, RejectsMalformedRequestsAndContexts) {
    const uint8_t invalid[] = {0, 1, 2, 3};
    EXPECT_THROW(ProcessBatch(invalid), std::invalid_argument);
    EXPECT_THROW(ProcessBatch({}), std::invalid_argument);
    buffers::batch::BatchRequestT request;
    EXPECT_NO_THROW(RunBatch(request));
    auto context = std::make_unique<buffers::batch::DescriptorBufferT>();
    context->data.assign(std::begin(invalid), std::end(invalid));
    request.catalog_descriptors.push_back(std::move(context));
    EXPECT_THROW(RunBatch(request), std::invalid_argument);
}

TEST(BatchTest, EmptySqlIsValidAndDoesNotInventDiagnostics) {
    buffers::batch::BatchRequestT request;
    AddInput(request, "empty", "", 15);
    auto bytes = RunBatch(request);
    auto* script = flatbuffers::GetRoot<buffers::batch::BatchResult>(bytes.data())->scripts()->Get(0);
    EXPECT_TRUE(!script->failure() || script->failure()->size() == 0);
    EXPECT_TRUE(!script->diagnostics() || script->diagnostics()->size() == 0);
    VerifyNested<buffers::parser::ScannedScript>(script->scanned());
    VerifyNested<buffers::parser::ParsedScript>(script->parsed());
    VerifyNested<buffers::analyzer::AnalyzedScript>(script->analyzed());
    VerifyNested<buffers::catalog::CatalogDescriptor>(script->catalog_descriptor());
}

TEST(BatchTest, StageSelectionLimitsDiagnosticsAndWarningsDoNotSuppressDescriptor) {
    buffers::batch::BatchRequestT request;
    AddInput(request, "scan", "create table broken(", 1);
    AddInput(request, "parse", "select * from a x, b x", 2);
    AddInput(request, "warning",
             "create table items(id int); select 1 as value visualize using vegalite "
             "(mark => bar, dashboard => (row => -1, column => 15, width => 20, height => 0))", 8);
    auto bytes = RunBatch(request);
    auto* scripts = flatbuffers::GetRoot<buffers::batch::BatchResult>(bytes.data())->scripts();
    for (uint32_t i = 0; i < 2; ++i) {
        EXPECT_TRUE(!scripts->Get(i)->diagnostics() || scripts->Get(i)->diagnostics()->size() == 0);
    }
    auto* warnings = scripts->Get(2)->diagnostics();
    ASSERT_NE(warnings, nullptr);
    ASSERT_EQ(warnings->size(), 4);
    for (auto* warning : *warnings) {
        EXPECT_EQ(warning->stage(), buffers::batch::ProcessingStage::ANALYZE);
        EXPECT_EQ(warning->severity(), buffers::batch::DiagnosticSeverity::WARNING);
        EXPECT_GT(warning->length(), 0);
    }
    VerifyNested<buffers::catalog::CatalogDescriptor>(scripts->Get(2)->catalog_descriptor());
}

TEST(BatchTest, BatchAndDescriptorAbiBorrowInputAndReturnOwnedOutput) {
    buffers::batch::BatchRequestT request;
    AddInput(request, "schema", "create table items(id int)", 8);
    auto input = Request(request);
    FFIResult output;
    dashql_process_batch(&output, input.data(), input.size());
    auto* script = flatbuffers::GetRoot<buffers::batch::BatchResult>(output.data_ptr)->scripts()->Get(0);
    ASSERT_NE(script->catalog_descriptor(), nullptr);
    Catalog receiver;
    auto id = dashql_catalog_allocate_entry_id(&receiver);
    dashql_catalog_replace_descriptor(&receiver, id, 7, script->catalog_descriptor()->data(),
                                      script->catalog_descriptor()->size());
    EXPECT_TRUE(receiver.Contains(id));
    auto version = receiver.GetVersion();
    const uint8_t invalid[] = {0, 1, 2, 3};
    EXPECT_THROW(dashql_catalog_replace_descriptor(nullptr, id, 7, invalid, sizeof(invalid)), Exception);
    EXPECT_THROW(dashql_catalog_replace_descriptor(&receiver, id, 7, nullptr, 0), std::invalid_argument);
    EXPECT_THROW(dashql_catalog_replace_descriptor(&receiver, id, 7, invalid, sizeof(invalid)), std::invalid_argument);
    EXPECT_THROW(dashql_catalog_replace_descriptor(&receiver, id, 7, invalid, 0), std::invalid_argument);
    EXPECT_EQ(receiver.GetVersion(), version);
    receiver.IterateRanked([&](auto entry_id, auto& entry, auto rank) {
        EXPECT_EQ(entry_id, id);
        EXPECT_EQ(rank, 7);
        EXPECT_EQ(entry.GetCatalogVersion(), version);
    });
    dashql_delete_owner(output.owner_ptr, output.owner_deleter);
    ASSERT_NE(receiver.ResolveTable(CatalogTableID(id, 0)), nullptr);
    EXPECT_EQ(receiver.ResolveTable(CatalogTableID(id, 0))->table_name.table_name.get().text, "items");
    dashql_catalog_drop_descriptor(&receiver, id);
    EXPECT_FALSE(receiver.Contains(id));
    flatbuffers::Verifier verifier{input.data(), input.size()};
    EXPECT_TRUE(verifier.VerifyBuffer<buffers::batch::BatchRequest>(nullptr));
}

}  // namespace
