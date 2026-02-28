#include "c4/yml/std/std.hpp"
#include "dashql/script_registry.h"
#include "dashql/testing/registry_snapshot_test.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

using namespace dashql;
using namespace dashql::testing;

namespace {

struct RegistrySnapshotTestSuite : public ::testing::TestWithParam<const RegistrySnapshotTest*> {};

TEST_P(RegistrySnapshotTestSuite, Test) {
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

    Catalog catalog;
    std::vector<std::unique_ptr<Script>> catalog_scripts;
    size_t next_entry_id = 1;
    ASSERT_NO_FATAL_FAILURE(AnalyzerSnapshotTest::TestCatalogSnapshot(test->catalog_scripts, catalog_node, catalog,
                                                                      catalog_scripts, next_entry_id));

    ScriptRegistry registry;
    std::vector<std::unique_ptr<Script>> registry_scripts;
    ASSERT_NO_FATAL_FAILURE(RegistrySnapshotTest::TestRegistrySnapshot(test->registry_scripts, registry_node, catalog,
                                                                       registry, registry_scripts, next_entry_id));
}

// clang-format off

INSTANTIATE_TEST_SUITE_P(Basic, RegistrySnapshotTestSuite, ::testing::ValuesIn(RegistrySnapshotTest::GetTests("basic.yaml")), RegistrySnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Trino, RegistrySnapshotTestSuite, ::testing::ValuesIn(RegistrySnapshotTest::GetTests("trino.yaml")), RegistrySnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(TPCH, RegistrySnapshotTestSuite, ::testing::ValuesIn(RegistrySnapshotTest::GetTests("tpch.yaml")), RegistrySnapshotTest::TestPrinter());

}  // namespace
