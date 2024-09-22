#include "gtest/gtest.h"
#include "pugixml.hpp"
#include "sqlynx/catalog.h"
#include "sqlynx/script.h"
#include "sqlynx/testing/analyzer_snapshot_test.h"

using namespace sqlynx;
using namespace sqlynx::testing;

namespace {

struct AnalyzerSnapshotTestSuite : public ::testing::TestWithParam<const AnalyzerSnapshotTest*> {};

TEST_P(AnalyzerSnapshotTestSuite, Test) {
    auto* test = GetParam();

    pugi::xml_document out;
    auto main_node = out.append_child("script");
    auto catalog_node = out.append_child("catalog");

    // Read catalog
    Catalog catalog;
    std::vector<std::unique_ptr<Script>> catalog_scripts;
    size_t entry_id = 1;
    ASSERT_NO_FATAL_FAILURE(
        AnalyzerSnapshotTest::TestRegistrySnapshot(test->catalog, catalog_node, catalog, catalog_scripts, entry_id));

    // Read main script
    Script main_script{catalog, 0, test->script.database_name, test->script.schema_name};
    ASSERT_NO_FATAL_FAILURE(AnalyzerSnapshotTest::TestMainScriptSnapshot(test->script, main_node, main_script, 0));
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(Basic, AnalyzerSnapshotTestSuite, ::testing::ValuesIn(AnalyzerSnapshotTest::GetTests("basic.xml")), AnalyzerSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Multiple, AnalyzerSnapshotTestSuite, ::testing::ValuesIn(AnalyzerSnapshotTest::GetTests("multiple.xml")), AnalyzerSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(TPCH, AnalyzerSnapshotTestSuite, ::testing::ValuesIn(AnalyzerSnapshotTest::GetTests("tpch.xml")), AnalyzerSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(CrossDB, AnalyzerSnapshotTestSuite, ::testing::ValuesIn(AnalyzerSnapshotTest::GetTests("crossdb.xml")), AnalyzerSnapshotTest::TestPrinter());

}
