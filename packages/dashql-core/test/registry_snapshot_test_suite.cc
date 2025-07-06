#include "dashql/script_registry.h"
#include "dashql/testing/registry_snapshot_test.h"
#include "dashql/testing/xml_tests.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

using namespace dashql;
using namespace dashql::testing;

namespace {

struct RegistrySnapshotTestSuite : public ::testing::TestWithParam<const RegistrySnapshotTest*> {};

TEST_P(RegistrySnapshotTestSuite, Test) {
    auto* test = GetParam();

    // Prepare catalog
    Catalog catalog;
    std::optional<Script> catalog_script;
    size_t catalog_entry_id = 0;
    if (auto& text = test->catalog_script; text.has_value()) {
        catalog_entry_id = text.value().external_id;
        catalog_script.emplace(catalog, catalog_entry_id);

        auto& s = catalog_script.value();
        s.InsertTextAt(0, text.value().input);
        ASSERT_EQ(s.Scan(), buffers::status::StatusCode::OK);
        ASSERT_EQ(s.Parse(), buffers::status::StatusCode::OK);
        ASSERT_EQ(s.Analyze(), buffers::status::StatusCode::OK);

        catalog.LoadScript(s, 0);
    }

    // Analyze all registry scripts
    std::vector<std::unique_ptr<Script>> registry_scripts;
    for (auto& text : test->registry_scripts) {
        registry_scripts.push_back(std::make_unique<Script>(catalog, catalog_entry_id + 1 + registry_scripts.size()));

        auto& s = *registry_scripts.back();
        s.InsertTextAt(0, text);
        ASSERT_EQ(s.Scan(), buffers::status::StatusCode::OK);
        ASSERT_EQ(s.Parse(), buffers::status::StatusCode::OK);
        ASSERT_EQ(s.Analyze(), buffers::status::StatusCode::OK);
    }

    // Add all scripts
    ScriptRegistry registry;
    for (auto& script : registry_scripts) {
        registry.AddScript(*script);
    }

    pugi::xml_document out;
    auto registry_node = out.append_child("registry");
    RegistrySnapshotTest::EncodeRegistry(registry_node, registry);

    ASSERT_TRUE(Matches(out, test->expected));
}

// clang-format off

INSTANTIATE_TEST_SUITE_P(Basic, RegistrySnapshotTestSuite, ::testing::ValuesIn(RegistrySnapshotTest::GetTests("basic.xml")), RegistrySnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Trino, RegistrySnapshotTestSuite, ::testing::ValuesIn(RegistrySnapshotTest::GetTests("trino.xml")), RegistrySnapshotTest::TestPrinter());

} // namespace
