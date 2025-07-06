#include "dashql/testing/registry_snapshot_test.h"

#include <format>
#include <fstream>
#include <set>

#include "dashql/script_registry.h"
#include "dashql/testing/parser_snapshot_test.h"

namespace dashql {
namespace testing {

void RegistrySnapshotTest::EncodeRegistry(pugi::xml_node out, ScriptRegistry& registry) {
    using SnippetMap = std::unordered_map<ScriptSnippet::Key<true>, std::vector<std::unique_ptr<ScriptSnippet>>>;

    // Group snippets by (table_id, column_id) combination
    using TableColumnKey = std::pair<ContextObjectID, ColumnID>;
    std::map<TableColumnKey, SnippetMap> grouped_restriction_snippets;
    std::map<TableColumnKey, SnippetMap> grouped_transform_snippets;

    // Collect all unique (table_id, column_id) pairs
    std::set<TableColumnKey> unique_table_column_pairs;
    for (auto& restriction_tuple : registry.GetColumnRestrictions()) {
        auto [table_id, column_id, script_ptr] = restriction_tuple;
        unique_table_column_pairs.insert({table_id, column_id});
    }
    for (auto& transform_tuple : registry.GetColumnTransforms()) {
        auto [table_id, column_id, script_ptr] = transform_tuple;
        unique_table_column_pairs.insert({table_id, column_id});
    }

    // Collect column transforms and restrictions
    for (auto& [table_id, column_id] : unique_table_column_pairs) {
        TableColumnKey key{table_id, column_id};
        registry.CollectColumnRestrictions(table_id, column_id, std::nullopt, grouped_restriction_snippets[key]);
        registry.CollectColumnTransforms(table_id, column_id, std::nullopt, grouped_transform_snippets[key]);
    }

    // Write grouped snippets
    auto write_grouped_snippets = [](pugi::xml_node out, const std::map<TableColumnKey, SnippetMap>& grouped) {
        for (auto& [table_column_key, snippet_map] : grouped) {
            if (snippet_map.empty()) continue;
            auto [table_id, column_id] = table_column_key;
            auto templates_node = out.append_child("templates");

            std::string id = std::format("{}.{}", table_id.Pack(), column_id);
            templates_node.append_attribute("column").set_value(id.c_str());

            for (auto& [snippet_key, snippets] : snippet_map) {
                auto template_node = templates_node.append_child("template");
                template_node.append_attribute("signature").set_value(std::to_string(snippet_key.hash()).c_str());

                for (auto& snippet : snippets) {
                    auto snippet_node = template_node.append_child("snippet");
                    ParserSnapshotTest::EncodeAST(snippet_node, snippet->text, snippet->nodes, snippet->root_node_id);
                }
            }
        }
    };

    // Encode column restrictions
    if (!grouped_restriction_snippets.empty()) {
        auto restrictions_node = out.append_child("column-restrictions");
        write_grouped_snippets(restrictions_node, grouped_restriction_snippets);
    }
    // Encode column transforms
    if (!grouped_transform_snippets.empty()) {
        auto transforms_node = out.append_child("column-transforms");
        write_grouped_snippets(transforms_node, grouped_transform_snippets);
    }
}

// The files
static std::unordered_map<std::string, std::vector<RegistrySnapshotTest>> TEST_FILES;

void RegistrySnapshotTest::LoadTests(std::filesystem::path& source_dir) {
    auto snapshots_dir = source_dir / "snapshots" / "registry";
    std::cout << "Loading registry tests at: " << snapshots_dir << std::endl;

    for (auto& p : std::filesystem::directory_iterator(snapshots_dir)) {
        auto filename = p.path().filename().string();
        if (p.path().extension().string() != ".xml") continue;

        // Make sure that it's no template
        auto tpl = p.path();
        tpl.replace_extension();
        if (tpl.extension() == ".tpl") continue;

        // Open input stream
        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[ SETUP    ] failed to read test file: " << filename << std::endl;
            continue;
        }

        // Parse xml document
        pugi::xml_document doc;
        doc.load(in);
        auto root = doc.child("registry-snapshots");

        // Read tests
        std::vector<RegistrySnapshotTest> tests;
        for (auto test_node : root.children()) {
            tests.emplace_back();
            auto& test = tests.back();
            test.name = test_node.attribute("name").as_string();

            // Read catalog
            auto catalog_node = test_node.child("catalog");
            if (catalog_node) {
                auto catalog_id = catalog_node.attribute("id").as_int(0);
                test.catalog_script.emplace(CatalogScript{.external_id = static_cast<CatalogEntryID>(catalog_id),
                                                          .input = catalog_node.last_child().value()});
            }

            // Read scripts
            auto scripts_node = test_node.child("scripts");
            for (auto script_node : scripts_node.children()) {
                auto& script = test.registry_scripts.emplace_back();
                script = script_node.last_child().value();
            }

            // Copy column restrictions and transforms
            auto registry_node = test_node.child("registry");
            auto expected_root = test.expected.append_child("registry");
            expected_root.append_copy(registry_node.child("column-restrictions"));
            expected_root.append_copy(registry_node.child("column-transforms"));
        }

        std::cout << "[ SETUP    ] " << filename << ": " << tests.size() << " tests" << std::endl;

        // Register test
        TEST_FILES.insert({filename, std::move(tests)});
    }
}

std::vector<const RegistrySnapshotTest*> RegistrySnapshotTest::GetTests(std::string_view filename) {
    std::string name{filename};
    auto iter = TEST_FILES.find(name);
    if (iter == TEST_FILES.end()) {
        return {};
    }
    std::vector<const RegistrySnapshotTest*> tests;
    for (auto& test : iter->second) {
        tests.emplace_back(&test);
    }
    return tests;
}

}  // namespace testing
}  // namespace dashql
