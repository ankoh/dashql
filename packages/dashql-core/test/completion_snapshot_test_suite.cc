#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/script.h"
#include "dashql/testing/completion_snapshot_test.h"
#include "dashql/testing/registry_snapshot_test.h"
#include "dashql/testing/xml_tests.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

using namespace dashql;
using namespace dashql::testing;

namespace {

struct CompletionSnapshotTestSuite : public ::testing::TestWithParam<const CompletionSnapshotTest*> {};

TEST_P(CompletionSnapshotTestSuite, Test) {
    auto* test = GetParam();

    pugi::xml_document out;
    auto editor_node = out.append_child("editor");
    auto catalog_node = out.append_child("catalog");
    auto registry_node = out.append_child("registry");

    // Read catalog
    Catalog catalog;
    std::vector<std::unique_ptr<Script>> catalog_scripts;
    size_t next_entry_id = 1;
    ASSERT_NO_FATAL_FAILURE(AnalyzerSnapshotTest::TestCatalogSnapshot(test->catalog_scripts, catalog_node, catalog,
                                                                      catalog_scripts, next_entry_id));

    // Read registry
    ScriptRegistry registry;
    std::vector<std::unique_ptr<Script>> registry_scripts;
    ASSERT_NO_FATAL_FAILURE(RegistrySnapshotTest::TestRegistrySnapshot(test->registry_scripts, registry_node, catalog,
                                                                       registry, registry_scripts, next_entry_id));

    // Read main script
    Script editor_script{catalog, 0};
    ASSERT_NO_FATAL_FAILURE(
        AnalyzerSnapshotTest::TestScriptSnapshot(test->script, editor_node, editor_script, next_entry_id, true));

    // Determine cursor position
    std::string_view target_text = editor_script.scanned_script->GetInput();
    auto search_pos = target_text.find(test->cursor_search_string);
    auto cursor_pos = search_pos + test->cursor_search_index;
    ASSERT_NE(search_pos, std::string::npos);
    ASSERT_LE(cursor_pos, target_text.size());

    // Move cursor and get completion
    editor_script.MoveCursor(cursor_pos);
    auto [completion, completion_status] = editor_script.CompleteAtCursor(test->completion_limit, &registry);
    ASSERT_EQ(completion_status, buffers::status::StatusCode::OK);
    ASSERT_NE(completion, nullptr);

    auto completions = out.append_child("completions");
    completions.append_attribute("limit").set_value(test->completion_limit);
    CompletionSnapshotTest::EncodeCompletion(completions, *completion);

    auto& cursor = completion->GetCursor();
    EncodeLocation(completions, completion->GetTargetSymbol()->symbol.location, target_text);

    ASSERT_TRUE(Matches(out.child("completions"), test->completions));
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(Basic, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("basic.xml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Dots, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("dots.xml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(DotsWithCatalog, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("dots_catalog.xml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(TPCH, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("tpch.xml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Keywords, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("keywords.xml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(QualifiedNames, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("qualified_names.xml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(UnresolvedPeers, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("unresolved_peers.xml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(ResolvingTables, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("resolving_tables.xml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Casing, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("casing.xml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(ExpectedSymbols, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("expected_symbols.xml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Registry, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("registry.xml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Trino, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("trino.xml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Bigs, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("bugs.xml")), CompletionSnapshotTest::TestPrinter());

}
