#include "c4/yml/std/std.hpp"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/script.h"
#include "dashql/testing/completion_snapshot_test.h"
#include "dashql/testing/registry_snapshot_test.h"
#include "dashql/testing/yaml_tests.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

using namespace dashql;
using namespace dashql::testing;

namespace {

struct CompletionSnapshotTestSuite : public ::testing::TestWithParam<const CompletionSnapshotTest*> {};

TEST_P(CompletionSnapshotTestSuite, Test) {
    auto* test = GetParam();

    c4::yml::Tree out_tree;
    auto out_root = out_tree.rootref();
    out_root.set_type(c4::yml::MAP);
    auto catalog_node = out_root.append_child();
    catalog_node << c4::yml::key("catalog");
    catalog_node |= c4::yml::MAP;
    auto registry_node = out_root.append_child();
    registry_node << c4::yml::key("registry");
    registry_node |= c4::yml::SEQ;
    auto editor_node = out_root.append_child();
    editor_node << c4::yml::key("editor");
    editor_node |= c4::yml::MAP;

    Catalog catalog;
    std::vector<std::unique_ptr<Script>> catalog_scripts;
    size_t next_entry_id = 1;
    ASSERT_NO_FATAL_FAILURE(AnalyzerSnapshotTest::TestCatalogSnapshot(test->catalog_scripts, catalog_node, catalog,
                                                                      catalog_scripts, next_entry_id));

    ScriptRegistry registry;
    std::vector<std::unique_ptr<Script>> registry_scripts;
    ASSERT_NO_FATAL_FAILURE(RegistrySnapshotTest::TestRegistrySnapshot(test->registry_scripts, registry_node, catalog,
                                                                       registry, registry_scripts, next_entry_id));

    Script editor_script{catalog, 0};
    ASSERT_NO_FATAL_FAILURE(
        AnalyzerSnapshotTest::TestScriptSnapshot(test->script, editor_node, editor_script, 0, true));

    std::string_view target_text = editor_script.scanned_script->GetInput();
    auto search_pos = target_text.find(test->cursor_search_string);
    auto cursor_pos = search_pos + test->cursor_search_index;
    ASSERT_NE(search_pos, std::string::npos);
    ASSERT_LE(cursor_pos, target_text.size());

    editor_script.MoveCursor(cursor_pos);
    auto [completion, completion_status] = editor_script.CompleteAtCursor(test->completion_limit, &registry);
    ASSERT_EQ(completion_status, buffers::status::StatusCode::OK);
    ASSERT_NE(completion, nullptr);

    auto completions_node = out_root.append_child();
    completions_node << c4::yml::key("completions");
    completions_node |= c4::yml::MAP;
    completions_node.append_child() << c4::yml::key("limit") << test->completion_limit;
    CompletionSnapshotTest::EncodeCompletion(completions_node, *completion);

    EncodeLocationText(completions_node, completion->GetTargetSymbol()->symbol.location, target_text, "text");

    if (test->completions_tree && test->completions_node_id != c4::yml::NONE) {
        auto expected = test->completions_tree->ref(test->completions_node_id);
        ASSERT_TRUE(Matches(completions_node, expected));
    }
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(Basic, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("basic.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Dots, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("dots.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(DotsWithCatalog, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("dots_catalog.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(TPCH, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("tpch.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Keywords, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("keywords.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(QualifiedNames, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("qualified_names.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(UnresolvedPeers, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("unresolved_peers.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(ResolvingTables, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("resolving_tables.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(ResolvingColumns, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("resolving_columns.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Casing, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("casing.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(ExpectedSymbols, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("expected_symbols.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Registry, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("registry.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Trino, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("trino.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Bugs, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("bugs.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Cursor, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("cursor.yaml")), CompletionSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Quotes, CompletionSnapshotTestSuite, ::testing::ValuesIn(CompletionSnapshotTest::GetTests("quotes.yaml")), CompletionSnapshotTest::TestPrinter());

}
