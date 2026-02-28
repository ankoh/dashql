#include "dashql/testing/completion_snapshot_test.h"

#include <format>
#include <fstream>
#include <sstream>

#include "c4/yml/std/std.hpp"
#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"
#include "dashql/testing/registry_snapshot_test.h"
#include "dashql/testing/yaml_tests.h"
#include "dashql/text/names.h"
#include "dashql/utils/string_conversion.h"
#include "dashql/utils/string_trimming.h"
#include "ryml.hpp"

namespace dashql {
namespace testing {

struct CompletionSnapshotFile {
    std::string content;
    c4::yml::Tree tree;
    std::vector<CompletionSnapshotTest> tests;
};
static std::unordered_map<std::string, CompletionSnapshotFile> TEST_FILES;

std::vector<const CompletionSnapshotTest*> CompletionSnapshotTest::GetTests(std::string_view filename) {
    std::string name{filename};
    auto iter = TEST_FILES.find(name);
    if (iter == TEST_FILES.end()) {
        return {};
    }
    std::vector<const CompletionSnapshotTest*> tests;
    for (auto& test : iter->second.tests) {
        tests.emplace_back(&test);
    }
    return tests;
}

/// Encode completion to YAML
void CompletionSnapshotTest::EncodeCompletion(c4::yml::NodeRef root, const Completion& completion) {
    auto& entries = completion.GetResultCandidates();
    std::string_view script = completion.GetCursor().script.scanned_script->GetInput();

    root.append_child() << c4::yml::key("strategy")
                       << std::string(buffers::completion::EnumNameCompletionStrategy(completion.GetStrategy()));
    if (completion.IsDotCompletion()) {
        root.append_child() << c4::yml::key("dot") << true;
    }
    if (auto node_id = completion.GetCursor().ast_node_id) {
        root.append_child() << c4::yml::key("symbol")
                            << std::string(buffers::parser::EnumNameNodeType(
                                  completion.GetCursor().script.parsed_script->nodes[*node_id].node_type()));
        root.append_child() << c4::yml::key("relative")
                            << std::string(
                                  buffers::cursor::EnumNameRelativeSymbolPosition(completion.GetTargetSymbol()->relative_pos));
    }
    auto entries_node = root.append_child();
    entries_node << c4::yml::key("entries");
    entries_node |= c4::yml::SEQ;
    for (auto iter = entries.begin(); iter != entries.end(); ++iter) {
        auto yml_entry = entries_node.append_child();
        yml_entry.set_type(c4::yml::MAP);
        yml_entry.append_child() << c4::yml::key("score") << iter->score;
        std::string text{iter->completion_text.data(), iter->completion_text.size()};
        yml_entry.append_child() << c4::yml::key("value") << text;
        c4::yml::NodeRef ntags_node;
        bool first_ntag = true;
        iter->coarse_name_tags.ForEach([&](buffers::analyzer::NameTag tag) {
            if (first_ntag) {
                ntags_node = yml_entry.append_child();
                ntags_node << c4::yml::key("ntags");
                ntags_node |= c4::yml::SEQ;
                ntags_node.set_container_style(c4::yml::FLOW_SL);
                first_ntag = false;
            }
            ntags_node.append_child() << std::string(buffers::analyzer::EnumNameNameTag(tag));
        });
        c4::yml::NodeRef ctags_node;
        bool first_ctag = true;
        iter->candidate_tags.ForEach([&](buffers::completion::CandidateTag tag) {
            if (first_ctag) {
                ctags_node = yml_entry.append_child();
                ctags_node << c4::yml::key("ctags");
                ctags_node |= c4::yml::SEQ;
                ctags_node.set_container_style(c4::yml::FLOW_SL);
                first_ctag = false;
            }
            ctags_node.append_child() << std::string(buffers::completion::EnumNameCandidateTag(tag));
        });
        EncodeLocationText(yml_entry, iter->target_location, script, "target");
        if (iter->target_location_qualified.offset() != 0 || iter->target_location_qualified.length() != 0) {
            EncodeLocationText(yml_entry, iter->target_location_qualified, script, "qualified");
        }
        auto objects_node = yml_entry.append_child();
        objects_node << c4::yml::key("objects");
        objects_node |= c4::yml::SEQ;
        for (auto& co : iter->catalog_objects) {
            auto& obj = co.catalog_object;
            auto yml_obj = objects_node.append_child();
            yml_obj.set_type(c4::yml::MAP);
            yml_obj.append_child() << c4::yml::key("score") << co.score;
            switch (obj.GetObjectType()) {
                case dashql::CatalogObjectType::DatabaseReference: {
                    auto* t = static_cast<const CatalogEntry::DatabaseReference*>(&obj);
                    yml_obj.append_child() << c4::yml::key("type") << "database";
                    auto id_node = yml_obj.append_child();
                    id_node << c4::yml::key("id") << std::format("{}", t->GetDatabaseID());
                    id_node.set_val_style(c4::yml::VAL_DQUO);  // quote so YAML does not parse as float
                    break;
                }
                case dashql::CatalogObjectType::SchemaReference: {
                    auto* t = static_cast<const CatalogEntry::SchemaReference*>(&obj);
                    yml_obj.append_child() << c4::yml::key("type") << "schema";
                    auto id_node = yml_obj.append_child();
                    id_node << c4::yml::key("id") << std::format("{}.{}", t->GetDatabaseID(), t->GetSchemaID());
                    id_node.set_val_style(c4::yml::VAL_DQUO);  // quote so YAML does not parse as float
                    break;
                }
                case dashql::CatalogObjectType::TableDeclaration: {
                    auto* t = static_cast<const CatalogEntry::TableDeclaration*>(&obj);
                    auto [db_id, schema_id] = t->catalog_schema_id.UnpackSchemaID();
                    yml_obj.append_child() << c4::yml::key("type") << "table";
                    auto id_node = yml_obj.append_child();
                    id_node << c4::yml::key("id")
                            << std::format("{}.{}.{}", db_id, schema_id, t->GetTableID().Pack());
                    id_node.set_val_style(c4::yml::VAL_DQUO);  // quote so YAML does not parse as float
                    break;
                }
                case dashql::CatalogObjectType::ColumnDeclaration: {
                    auto& c = *static_cast<const CatalogEntry::TableColumn*>(&obj);
                    auto& t = c.table->get();
                    auto [db_id, schema_id] = t.catalog_schema_id.UnpackSchemaID();
                    auto [table_id, column_idx] = c.object_id.UnpackTableColumnID();
                    yml_obj.append_child() << c4::yml::key("type") << "column";
                    auto id_node = yml_obj.append_child();
                    id_node << c4::yml::key("id")
                            << std::format("{}.{}.{}.{}", db_id, schema_id, table_id.Pack(), column_idx);
                    id_node.set_val_style(c4::yml::VAL_DQUO);  // quote so YAML does not parse as float
                    break;
                }
                default:
                    assert(false);
            }
            c4::yml::NodeRef obj_ctags_node;
            bool first_obj_ctag = true;
            co.candidate_tags.ForEach([&](buffers::completion::CandidateTag tag) {
                if (first_obj_ctag) {
                    obj_ctags_node = yml_obj.append_child();
                    obj_ctags_node << c4::yml::key("ctags");
                    obj_ctags_node |= c4::yml::SEQ;
                    obj_ctags_node.set_container_style(c4::yml::FLOW_SL);
                    first_obj_ctag = false;
                }
                obj_ctags_node.append_child() << std::string(buffers::completion::EnumNameCandidateTag(tag));
            });
            if (!co.qualified_name.empty()) {
                std::stringstream name;
                for (size_t j = 0; j < co.qualified_name.size(); ++j) {
                    if (j > 0) name << ".";
                    name << QuotedIfAnyUpper{co.qualified_name[j]};
                }
                yml_obj.append_child() << c4::yml::key("qualified") << name.str();
                yml_obj.append_child() << c4::yml::key("qualified_idx") << co.qualified_name_target_idx;
                yml_obj.append_child() << c4::yml::key("prefer_qualified") << co.prefer_qualified;
            }
            if (co.script_snippets.has_value()) {
                auto& snippets = co.script_snippets->get();
                if (!snippets.filter_snippets.empty() || !snippets.computation_snippets.empty()) {
                    auto templates_entry = yml_obj.append_child();
                    templates_entry << c4::yml::key("templates");
                    templates_entry |= c4::yml::MAP;
                    RegistrySnapshotTest::EncodeScriptTemplates(templates_entry, snippets.filter_snippets);
                    RegistrySnapshotTest::EncodeScriptTemplates(templates_entry, snippets.computation_snippets);
                }
            }
        }
    }
}

void CompletionSnapshotTest::LoadTests(const std::filesystem::path& snapshots_dir) {
    std::cout << "Loading completion tests at: " << snapshots_dir << std::endl;

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

        CompletionSnapshotFile file;
        file.content = std::move(content);
        c4::yml::parse_in_arena(c4::to_csubstr(file.content), &file.tree);

        auto root = file.tree.rootref();
        if (!root.has_child("completion-snapshots")) {
            std::cout << "[ SETUP    ] " << filename << ": no completion-snapshots key" << std::endl;
            continue;
        }
        auto snapshots = root["completion-snapshots"];
        for (auto test_node : snapshots.children()) {
            file.tests.emplace_back();
            auto& test = file.tests.back();
            if (test_node.has_child("name")) {
                c4::csubstr v = test_node["name"].val();
                test.name = v.str ? std::string(v.str, v.len) : std::string();
            }
            if (test_node.has_child("catalog") && test_node["catalog"].has_child("script")) {
                auto script_node = test_node["catalog"]["script"];
                test.catalog_scripts.emplace_back();
                auto& entry = test.catalog_scripts.back();
                entry.ReadFrom(script_node);
                entry.tree = &file.tree;
                entry.node_id = script_node.id();
            }
            if (test_node.has_child("registry")) {
                for (auto entry_item : test_node["registry"].children()) {
                    if (!entry_item.has_child("script")) continue;
                    auto script_node = entry_item["script"];
                    test.registry_scripts.emplace_back();
                    auto& entry = test.registry_scripts.back();
                    entry.ReadFrom(script_node);
                    entry.tree = &file.tree;
                    entry.node_id = script_node.id();
                }
            }
            if (test_node.has_child("editor")) {
                auto script_node = test_node["editor"];
                test.script.ReadFrom(script_node);
                test.script.tree = &file.tree;
                test.script.node_id = script_node.id();
            }
            if (test_node.has_child("cursor") && test_node["cursor"].has_child("search")) {
                auto search = test_node["cursor"]["search"];
                if (search.has_child("text")) {
                    c4::csubstr v = search["text"].val();
                    test.cursor_search_string = v.str ? std::string(v.str, v.len) : std::string();
                }
                if (search.has_child("index")) {
                    c4::csubstr v = search["index"].val();
                    test.cursor_search_index = v.str ? static_cast<size_t>(std::atoi(v.str)) : 0;
                }
            }
            if (test_node.has_child("completions")) {
                auto completions_node = test_node["completions"];
                test.completions_tree = &file.tree;
                test.completions_node_id = completions_node.id();
                if (completions_node.has_child("limit")) {
                    c4::csubstr v = completions_node["limit"].val();
                    test.completion_limit = v.str ? static_cast<size_t>(std::atoi(v.str)) : 100;
                }
            }
        }

        std::cout << "[ SETUP    ] " << filename << ": " << file.tests.size() << " tests" << std::endl;
        auto it = TEST_FILES.insert({filename, std::move(file)}).first;
        for (auto& t : it->second.tests) {
            t.script.tree = &it->second.tree;
            for (auto& e : t.catalog_scripts) e.tree = &it->second.tree;
            for (auto& e : t.registry_scripts) e.tree = &it->second.tree;
            t.completions_tree = &it->second.tree;
        }
    }
}

}  // namespace testing
}  // namespace dashql
