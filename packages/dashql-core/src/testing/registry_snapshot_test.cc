#include "dashql/testing/registry_snapshot_test.h"

#include <format>
#include <fstream>
#include <sstream>

#include "c4/yml/std/std.hpp"
#include "dashql/script_registry.h"
#include "dashql/testing/parser_snapshot_test.h"
#include "dashql/utils/string_trimming.h"
#include "ryml.hpp"

namespace dashql {
namespace testing {

void RegistrySnapshotTest::TestRegistrySnapshot(const std::vector<AnalyzerSnapshotTest::ScriptAnalysisSnapshot>& snaps,
                                                c4::yml::NodeRef registry_node, Catalog& catalog,
                                                ScriptRegistry& registry,
                                                std::vector<std::unique_ptr<Script>>& registry_scripts,
                                                size_t& entry_ids) {
    for (size_t i = 0; i < snaps.size(); ++i) {
        auto& entry = snaps[i];
        auto entry_id = entry_ids++;

        registry_scripts.push_back(std::make_unique<Script>(catalog, entry_id));
        auto& script = *registry_scripts.back();

        // registry_node is a SEQ; each element must be a MAP so that the "script" key has a map parent (rapidyaml
        // requirement).
        auto entry_node = registry_node.append_child();
        entry_node |= c4::yml::MAP;
        auto script_key_node = entry_node.append_child();
        script_key_node << c4::yml::key("script");
        script_key_node |= c4::yml::MAP;
        AnalyzerSnapshotTest::TestScriptSnapshot(entry, script_key_node, script, entry_id, false);

        registry.AddScript(script);
    }
}

void RegistrySnapshotTest::EncodeScriptTemplates(c4::yml::NodeRef out, const ScriptRegistry::SnippetMap& snippets) {
    std::vector<std::pair<ScriptSnippet::Key<true>, std::vector<ScriptSnippet*>>> snippets_ordered;
    for (auto& [snippet_key, snippet_list] : snippets) {
        std::vector<ScriptSnippet*> snippet_ptrs;
        snippet_ptrs.reserve(snippet_list.size());
        for (auto& snippet : snippet_list) {
            snippet_ptrs.push_back(snippet.get());
        }
        std::sort(snippet_ptrs.begin(), snippet_ptrs.end(),
                  [&](ScriptSnippet* l, ScriptSnippet* r) { return l->text < r->text; });
        snippets_ordered.emplace_back(snippet_key, std::move(snippet_ptrs));
    }
    std::sort(snippets_ordered.begin(), snippets_ordered.end(),
              [&](auto& l, auto& r) { return std::get<0>(l).hash() < std::get<0>(r).hash(); });

    out |= c4::yml::SEQ;
    for (auto& [snippet_key, snippet_list] : snippets_ordered) {
        auto item_node = out.append_child();
        item_node.set_type(c4::yml::MAP);
        auto template_node = item_node.append_child();
        template_node << c4::yml::key("template");
        template_node |= c4::yml::MAP;
        template_node.append_child() << c4::yml::key("signature") << std::to_string(snippet_key.hash());

        auto snippets_seq = template_node.append_child();
        snippets_seq << c4::yml::key("snippets");
        snippets_seq |= c4::yml::SEQ;
        for (auto* snippet : snippet_list) {
            auto snippet_node = snippets_seq.append_child();
            snippet_node.set_type(c4::yml::MAP);
            snippet_node.append_child() << c4::yml::key("signature-template") << std::to_string(snippet_key.hash());
            snippet_node.append_child() << c4::yml::key("signature-raw")
                                        << std::to_string(snippet->ComputeSignature(false));
            snippet_node.append_child() << c4::yml::key("text") << std::string{snippet->text};
            auto out_nodes = snippet_node.append_child();
            out_nodes << c4::yml::key("ast");
            out_nodes |= c4::yml::MAP;
            out_nodes.append_child() << c4::yml::key("ast-nodes") << snippet->nodes.size();
            out_nodes.append_child() << c4::yml::key("ast-bytes")
                                     << (snippet->nodes.size() * sizeof(buffers::parser::Node));
            ParserSnapshotTest::EncodeAST(out_nodes, snippet->text, snippet->nodes, snippet->root_node_id);
        }
    }
}

struct RegistrySnapshotFile {
    std::string content;
    c4::yml::Tree tree;
    std::vector<RegistrySnapshotTest> tests;
};
static std::unordered_map<std::string, RegistrySnapshotFile> TEST_FILES;

void RegistrySnapshotTest::LoadTests(const std::filesystem::path& snapshots_dir) {
    std::cout << "Loading registry tests at: " << snapshots_dir << std::endl;

    for (auto& p : std::filesystem::directory_iterator(snapshots_dir)) {
        auto filename = p.path().filename().string();
        if (p.path().extension().string() != ".yaml") continue;
        if (filename.find(".tpl.") != std::string::npos) continue;

        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[ SETUP    ] failed to read test file: " << filename << std::endl;
            continue;
        }
        std::stringstream buf;
        buf << in.rdbuf();
        std::string content = buf.str();

        RegistrySnapshotFile file;
        file.content = std::move(content);
        c4::yml::parse_in_arena(c4::to_csubstr(file.content), &file.tree);

        auto root = file.tree.rootref();
        if (!root.has_child("registry-snapshots")) {
            std::cout << "[ SETUP    ] " << filename << ": no registry-snapshots key" << std::endl;
            continue;
        }
        auto snapshots = root["registry-snapshots"];
        for (auto test_node : snapshots.children()) {
            file.tests.emplace_back();
            auto& test = file.tests.back();
            if (test_node.has_child("name")) {
                c4::csubstr v = test_node["name"].val();
                test.name = v.str ? std::string(v.str, v.len) : std::string();
            }
            if (test_node.has_child("catalog")) {
                auto catalog_node = test_node["catalog"];
                if (catalog_node.has_child("script")) {
                    auto script_node = catalog_node["script"];
                    test.catalog_scripts.emplace_back();
                    auto& entry = test.catalog_scripts.back();
                    entry.ReadFrom(script_node);
                    entry.tree = &file.tree;
                    entry.node_id = script_node.id();
                }
            }
            if (test_node.has_child("registry")) {
                auto registry_node = test_node["registry"];
                for (auto entry_item : registry_node.children()) {
                    if (!entry_item.has_child("script")) continue;
                    auto script_node = entry_item["script"];
                    test.registry_scripts.emplace_back();
                    auto& entry = test.registry_scripts.back();
                    entry.ReadFrom(script_node);
                    entry.tree = &file.tree;
                    entry.node_id = script_node.id();
                }
            }
        }

        std::cout << "[ SETUP    ] " << filename << ": " << file.tests.size() << " tests" << std::endl;
        auto it = TEST_FILES.insert({filename, std::move(file)}).first;
        for (auto& t : it->second.tests) {
            for (auto& e : t.catalog_scripts) e.tree = &it->second.tree;
            for (auto& e : t.registry_scripts) e.tree = &it->second.tree;
        }
    }
}

std::vector<const RegistrySnapshotTest*> RegistrySnapshotTest::GetTests(std::string_view filename) {
    std::string name{filename};
    auto iter = TEST_FILES.find(name);
    if (iter == TEST_FILES.end()) {
        return {};
    }
    std::vector<const RegistrySnapshotTest*> tests;
    for (auto& test : iter->second.tests) {
        tests.emplace_back(&test);
    }
    return tests;
}

}  // namespace testing
}  // namespace dashql
