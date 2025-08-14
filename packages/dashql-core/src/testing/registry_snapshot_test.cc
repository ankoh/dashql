#include "dashql/testing/registry_snapshot_test.h"

#include <format>
#include <fstream>
#include <set>

#include "dashql/script_registry.h"
#include "dashql/testing/parser_snapshot_test.h"

namespace dashql {
namespace testing {

void RegistrySnapshotTest::TestRegistrySnapshot(const std::vector<AnalyzerSnapshotTest::ScriptAnalysisSnapshot>& snaps,
                                                pugi::xml_node& node, Catalog& catalog, ScriptRegistry& registry,
                                                std::vector<std::unique_ptr<Script>>& registry_scripts,
                                                size_t& entry_ids) {
    for (size_t i = 0; i < snaps.size(); ++i) {
        auto& entry = snaps[i];
        auto entry_id = entry_ids++;

        // Create a new script
        registry_scripts.push_back(std::make_unique<Script>(catalog, entry_id));
        auto& script = *registry_scripts.back();

        // Make sure the analysis snapshot looks as expected
        auto script_node = node.append_child("script");
        AnalyzerSnapshotTest::TestScriptSnapshot(entry, script_node, script, entry_id, false);

        // Add script to registry
        registry.AddScript(script);

        // Note that we're not adding registry scripts to the catalog here.
        // The test would have to do explicitly if wished.
        // Or we introduce an xml flag like catalog="true" to registry scripts.
        // Add once needed.
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

            // Read catalog scripts
            auto catalog_node = test_node.child("catalog");
            for (auto entry_node : catalog_node.children()) {
                test.catalog_scripts.emplace_back();
                auto& entry = test.catalog_scripts.back();
                std::string entry_name = entry_node.name();
                if (entry_name == "script") {
                    entry.ReadFrom(entry_node);
                } else {
                    std::cout << "[    ERROR ] unknown test element " << entry_name << std::endl;
                }
            }

            // Read registry scripts
            auto registry_node = test_node.child("registry");
            for (auto script_node : registry_node.children()) {
                auto& script = test.registry_scripts.emplace_back();
                script.ReadFrom(script_node);
            }
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
