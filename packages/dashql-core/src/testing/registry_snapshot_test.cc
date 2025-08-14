#include "dashql/testing/registry_snapshot_test.h"

#include <format>
#include <fstream>
#include <set>

#include "dashql/script_registry.h"
#include "dashql/testing/parser_snapshot_test.h"
#include "dashql/testing/xml_tests.h"

namespace dashql {
namespace testing {

void RegistrySnapshotTest::TestRegistrySnapshot(const std::vector<AnalyzerSnapshotTest::ScriptAnalysisSnapshot>& snaps,
                                                pugi::xml_node& node, Catalog& catalog, ScriptRegistry& registry,
                                                std::vector<std::unique_ptr<Script>>& registry_scripts,
                                                size_t& entry_ids) {
    for (size_t i = 0; i < snaps.size(); ++i) {
        auto& entry = snaps[i];
        auto entry_id = entry_ids++;
        registry_scripts.push_back(std::make_unique<Script>(catalog, entry_id));

        auto& script = *registry_scripts.back();
        script.InsertTextAt(0, entry.input);
        ASSERT_EQ(script.Scan(), buffers::status::StatusCode::OK);
        ASSERT_EQ(script.Parse(), buffers::status::StatusCode::OK);
        ASSERT_EQ(script.Analyze(), buffers::status::StatusCode::OK);

        registry.AddScript(script);

        auto script_node = node.append_child("script");
        AnalyzerSnapshotTest::EncodeScript(script_node, *script.analyzed_script, false);

        ASSERT_TRUE(Matches(script_node.child("errors"), entry.errors));
        ASSERT_TRUE(Matches(script_node.child("tables"), entry.tables));
        ASSERT_TRUE(Matches(script_node.child("table-refs"), entry.table_references));
        ASSERT_TRUE(Matches(script_node.child("expressions"), entry.expressions));
        ASSERT_TRUE(Matches(script_node.child("constants"), entry.constant_expressions));
        ASSERT_TRUE(Matches(script_node.child("column-transforms"), entry.column_transforms));
        ASSERT_TRUE(Matches(script_node.child("column-restrictions"), entry.column_resrictions));
    }
}

void RegistrySnapshotTest::EncodeScriptTemplates(pugi::xml_node out, const ScriptRegistry::SnippetMap& snippets) {
    // Order the template snippets by the signature.
    // And order the referenced snippets per group by snippet text.
    std::vector<std::pair<ScriptSnippet::Key<true>, std::vector<ScriptSnippet*>>> snippets_ordered;
    for (auto& [snippet_key, snippets] : snippets) {
        std::vector<ScriptSnippet*> snippet_ptrs;
        snippet_ptrs.reserve(snippets.size());
        for (auto& snippet : snippets) {
            snippet_ptrs.push_back(snippet.get());
        }
        std::sort(snippet_ptrs.begin(), snippet_ptrs.end(),
                  [&](ScriptSnippet* l, ScriptSnippet*& r) { return l->text < r->text; });
        snippets_ordered.emplace_back(snippet_key, std::move(snippet_ptrs));
    }
    std::sort(snippets_ordered.begin(), snippets_ordered.end(),
              [&](auto& l, auto& r) { return std::get<0>(l).hash() < std::get<0>(r).hash(); });

    for (auto& [snippet_key, snippets] : snippets_ordered) {
        auto template_node = out.append_child("template");
        template_node.append_attribute("signature").set_value(std::to_string(snippet_key.hash()).c_str());

        for (auto& snippet : snippets) {
            auto snippet_node = template_node.append_child("snippet");
            auto sig_raw = snippet->ComputeSignature(false);
            snippet_node.append_attribute("template").set_value(std::to_string(snippet_key.hash()).c_str());
            snippet_node.append_attribute("raw").set_value(std::to_string(sig_raw).c_str());
            snippet_node.append_child("text").text().set(std::string{snippet->text}.c_str());
            auto out_nodes = snippet_node.append_child("nodes");
            out_nodes.append_attribute("count").set_value(snippet->nodes.size());
            out_nodes.append_attribute("bytes").set_value(snippet->nodes.size() * sizeof(buffers::parser::Node));
            ParserSnapshotTest::EncodeAST(out_nodes, snippet->text, snippet->nodes, snippet->root_node_id);
        }
    }
}

void RegistrySnapshotTest::EncodeRegistry(pugi::xml_node out, ScriptRegistry& registry) {
    // Group snippets by (table_id, column_id) combination
    using TableColumnKey = std::pair<ContextObjectID, ColumnID>;
    std::map<TableColumnKey, ScriptRegistry::SnippetMap> grouped_restriction_snippets;
    std::map<TableColumnKey, ScriptRegistry::SnippetMap> grouped_transform_snippets;

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
    auto write_grouped_snippets = [](pugi::xml_node out,
                                     std::map<TableColumnKey, ScriptRegistry::SnippetMap>& grouped) {
        for (auto& [table_column_key, snippet_map] : grouped) {
            if (snippet_map.empty()) continue;
            auto [table_id, column_id] = table_column_key;
            auto templates_node = out.append_child("templates");

            std::string id = std::format("{}.{}", table_id.Pack(), column_id);
            templates_node.append_attribute("column").set_value(id.c_str());

            EncodeScriptTemplates(templates_node, snippet_map);
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
