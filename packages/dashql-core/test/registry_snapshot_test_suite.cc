#include "dashql/script_registry.h"
#include "dashql/testing/registry_snapshot_test.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

using namespace dashql;
using namespace dashql::testing;

namespace {

struct RegistrySnapshotTestSuite : public ::testing::TestWithParam<const RegistrySnapshotTest*> {};

TEST_P(RegistrySnapshotTestSuite, Test) {
    auto* test = GetParam();

    pugi::xml_document out;
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

    // XXX We could test the btree entries by listing all filter & computation keys
}

// clang-format off

INSTANTIATE_TEST_SUITE_P(Basic, RegistrySnapshotTestSuite, ::testing::ValuesIn(RegistrySnapshotTest::GetTests("basic.xml")), RegistrySnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Trino, RegistrySnapshotTestSuite, ::testing::ValuesIn(RegistrySnapshotTest::GetTests("trino.xml")), RegistrySnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(TPCH, RegistrySnapshotTestSuite, ::testing::ValuesIn(RegistrySnapshotTest::GetTests("tpch.xml")), RegistrySnapshotTest::TestPrinter());

} // namespace
