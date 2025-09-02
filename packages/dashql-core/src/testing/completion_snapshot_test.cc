#include "dashql/testing/completion_snapshot_test.h"

#include <format>
#include <fstream>

#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"
#include "dashql/testing/registry_snapshot_test.h"
#include "dashql/testing/xml_tests.h"
#include "dashql/text/names.h"
#include "dashql/utils/string_conversion.h"

namespace dashql {
namespace testing {

// The files
static std::unordered_map<std::string, std::vector<CompletionSnapshotTest>> TEST_FILES;

// Get the tests
std::vector<const CompletionSnapshotTest*> CompletionSnapshotTest::GetTests(std::string_view filename) {
    std::string name{filename};
    auto iter = TEST_FILES.find(name);
    if (iter == TEST_FILES.end()) {
        return {};
    }
    std::vector<const CompletionSnapshotTest*> tests;
    for (auto& test : iter->second) {
        tests.emplace_back(&test);
    }
    return tests;
}

/// Encode a script
void CompletionSnapshotTest::EncodeCompletion(pugi::xml_node root, const Completion& completion) {
    auto& entries = completion.GetResultCandidates();

    auto ctxName = buffers::completion::EnumNameCompletionStrategy(completion.GetStrategy());
    root.append_attribute("strategy").set_value(ctxName);
    if (completion.IsDotCompletion()) {
        root.append_attribute("dot").set_value(true);
    }
    if (auto node_id = completion.GetCursor().ast_node_id) {
        root.append_attribute("symbol").set_value(buffers::parser::EnumNameNodeType(
            completion.GetCursor().script.parsed_script->nodes[*node_id].node_type()));
        root.append_attribute("relative")
            .set_value(
                buffers::cursor::EnumNameRelativeSymbolPosition(completion.GetCursor().scanner_location->relative_pos));
    }
    for (auto iter = entries.begin(); iter != entries.end(); ++iter) {
        auto xml_entry = root.append_child("entry");
        std::string text{iter->completion_text.data(), iter->completion_text.size()};
        xml_entry.append_attribute("score").set_value(iter->score);
        xml_entry.append_attribute("value").set_value(text.c_str());
        {
            std::stringstream name_tags;
            size_t i = 0;
            iter->coarse_name_tags.ForEach([&](buffers::analyzer::NameTag tag) {
                if (i++ > 0) {
                    name_tags << "|";
                }
                name_tags << buffers::analyzer::EnumNameNameTag(tag);
            });
            if (i > 0) {
                xml_entry.append_attribute("ntags").set_value(name_tags.str().c_str());
            }
        }
        {
            std::stringstream candidate_tags;
            size_t i = 0;
            iter->candidate_tags.ForEach([&](buffers::completion::CandidateTag tag) {
                if (i++ > 0) {
                    candidate_tags << "|";
                }
                candidate_tags << buffers::completion::EnumNameCandidateTag(tag);
            });
            if (i > 0) {
                xml_entry.append_attribute("ctags").set_value(candidate_tags.str().c_str());
            }
        }
        if (iter->prefer_qualified_tables) {
            xml_entry.append_attribute("qualify_tables").set_value(iter->prefer_qualified_tables);
        }
        if (iter->prefer_qualified_columns) {
            xml_entry.append_attribute("qualify_columns").set_value(iter->prefer_qualified_columns);
        }
        EncodeLocation(xml_entry, iter->target_location, completion.GetCursor().script.scanned_script->text_buffer,
                       "target_loc", "target_text");
        if (iter->target_location_qualified.offset() != 0 || iter->target_location_qualified.length() != 0) {
            EncodeLocation(xml_entry, iter->target_location_qualified,
                           completion.GetCursor().script.scanned_script->text_buffer, "qualified_loc",
                           "qualified_text");
        }
        for (auto& co : iter->catalog_objects) {
            auto& obj = co.catalog_object;
            auto xml_obj = xml_entry.append_child("object");
            xml_obj.append_attribute("score").set_value(co.score);
            switch (obj.GetObjectType()) {
                case dashql::CatalogObjectType::DatabaseReference: {
                    std::string type = "database";
                    auto* t = static_cast<const CatalogEntry::DatabaseReference*>(&obj);
                    xml_obj.append_attribute("type").set_value(type.c_str());
                    std::string catalog_id = std::format("{}", t->GetDatabaseID());
                    xml_obj.append_attribute("id").set_value(catalog_id.c_str());
                    break;
                }
                case dashql::CatalogObjectType::SchemaReference: {
                    std::string type = "schema";
                    auto* t = static_cast<const CatalogEntry::SchemaReference*>(&obj);
                    xml_obj.append_attribute("type").set_value(type.c_str());
                    std::string catalog_id = std::format("{}.{}", t->GetDatabaseID(), t->GetSchemaID());
                    xml_obj.append_attribute("id").set_value(catalog_id.c_str());
                    break;
                }
                case dashql::CatalogObjectType::TableDeclaration: {
                    std::string type = "table";
                    auto* t = static_cast<const CatalogEntry::TableDeclaration*>(&obj);
                    xml_obj.append_attribute("type").set_value(type.c_str());
                    auto [db_id, schema_id] = t->catalog_schema_id.UnpackSchemaID();
                    std::string catalog_id = std::format("{}.{}.{}", db_id, schema_id, t->GetTableID().Pack());
                    xml_obj.append_attribute("id").set_value(catalog_id.c_str());
                    break;
                }
                case dashql::CatalogObjectType::ColumnDeclaration: {
                    std::string type = "column";
                    auto& c = *static_cast<const CatalogEntry::TableColumn*>(&obj);
                    auto& t = c.table->get();
                    xml_obj.append_attribute("type").set_value(type.c_str());
                    auto [db_id, schema_id] = t.catalog_schema_id.UnpackSchemaID();
                    auto [table_id, column_idx] = c.object_id.UnpackTableColumnID();
                    std::string catalog_id = std::format("{}.{}.{}.{}", db_id, schema_id, table_id.Pack(), column_idx);
                    xml_obj.append_attribute("id").set_value(catalog_id.c_str());
                    break;
                }
                default:
                    assert(false);
            }
            // Encode the ctags of the candidate object
            {
                std::stringstream candidate_tags;
                size_t i = 0;
                co.candidate_tags.ForEach([&](buffers::completion::CandidateTag tag) {
                    if (i++ > 0) {
                        candidate_tags << "|";
                    }
                    candidate_tags << buffers::completion::EnumNameCandidateTag(tag);
                });
                if (i > 0) {
                    xml_obj.append_attribute("ctags").set_value(candidate_tags.str().c_str());
                }
            }
            // Encode the qualified name of the candidate object (if any)
            if (!co.qualified_name.empty()) {
                std::stringstream name;
                for (size_t i = 0; i < co.qualified_name.size(); ++i) {
                    name << ((i > 0) ? "." : "");
                    name << QuotedIfAnyUpper{co.qualified_name[i]};
                }
                xml_obj.append_attribute("qualified").set_value(name.str().c_str());
                xml_obj.append_attribute("qualified_idx").set_value(co.qualified_name_target_idx);
            }
        }

        // Encode snippets
        if (!iter->restriction_snippets.empty() || !iter->transform_snippets.empty()) {
            auto templates_entry = xml_entry.append_child("templates");
            RegistrySnapshotTest::EncodeScriptTemplates(templates_entry, iter->restriction_snippets);
            RegistrySnapshotTest::EncodeScriptTemplates(templates_entry, iter->transform_snippets);
        }
    }
}

/// Get the grammar tests
void CompletionSnapshotTest::LoadTests(std::filesystem::path& source_dir) {
    auto snapshots_dir = source_dir / "snapshots" / "completion";
    std::cout << "Loading completion tests at: " << snapshots_dir << std::endl;

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
        auto root = doc.child("completion-snapshots");

        // Read tests
        std::vector<CompletionSnapshotTest> tests;
        for (auto test_node : root.children()) {
            tests.emplace_back();
            auto& test = tests.back();
            test.name = test_node.attribute("name").as_string();

            // Read catalog
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

            // Read editor script
            auto editor_node = test_node.child("editor");
            test.script.ReadFrom(editor_node);

            // Read the cursor
            auto xml_cursor = test_node.child("cursor");
            auto xml_cursor_search = xml_cursor.child("search");
            test.cursor_search_string = xml_cursor_search.attribute("text").value();
            test.cursor_search_index = xml_cursor_search.attribute("index").as_int();

            // Read the expected completions
            auto completions = test_node.child("completions");
            test.completion_limit = completions.attribute("limit").as_int();
            test.completions.append_copy(completions);
        }

        std::cout << "[ SETUP    ] " << filename << ": " << tests.size() << " tests" << std::endl;

        // Register test
        TEST_FILES.insert({filename, std::move(tests)});
    }
}

}  // namespace testing
}  // namespace dashql
