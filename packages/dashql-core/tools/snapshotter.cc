#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <vector>

#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/formatter/formatter.h"
#include "dashql/parser/parser.h"
#include "dashql/parser/scanner.h"
#include "dashql/script.h"
#include "dashql/script_registry.h"
#include "dashql/testing/analyzer_snapshot_test.h"
#include "dashql/testing/completion_snapshot_test.h"
#include "dashql/testing/parser_snapshot_test.h"
#include "dashql/testing/plan_view_model_snapshot_test.h"
#include "dashql/testing/xml_tests.h"
#include "dashql/utils/string_trimming.h"
#include "dashql/view/plan_view_model.h"
#include "gflags/gflags.h"

using namespace dashql;
using namespace dashql::testing;

DEFINE_string(source_dir, "", "Source directory");

static void generate_parser_snapshots(const std::filesystem::path& snapshot_dir) {
    for (auto& p : std::filesystem::directory_iterator(snapshot_dir)) {
        auto filename = p.path().filename().filename().string();

        // Is template file file
        auto out = p.path();
        if (out.extension() != ".xml") continue;
        out.replace_extension();
        if (out.extension() != ".tpl") continue;
        out.replace_extension(".xml");

        // Open input stream
        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << filename << "] failed to read file" << std::endl;
            continue;
        }

        // Open output stream
        std::cout << "FILE " << out << std::endl;
        std::ofstream outs;
        outs.open(out, std::ofstream::out | std::ofstream::trunc);

        // Parse xml document
        pugi::xml_document doc;
        doc.load(in, pugi::parse_default | pugi::parse_comments);
        auto root = doc.child("parser-snapshots");

        for (auto test : root.children()) {
            if (test.type() != pugi::node_element) continue;
            // Copy expected
            auto name = test.attribute("name").as_string();
            std::cout << "  TEST " << name << std::endl;

            /// Parse module
            auto input = test.child("input");
            auto input_buffer = std::string{input.last_child().value()};
            rope::Rope input_rope{1024, input_buffer};
            auto scanned = parser::Scanner::Scan(input_rope, 0, 1);
            if (scanned.second != buffers::status::StatusCode::OK) {
                std::cout << "  ERROR " << buffers::status::EnumNameStatusCode(scanned.second) << std::endl;
                continue;
            }
            auto [parsed, parserError] = parser::Parser::Parse(scanned.first);

            /// Write output
            auto expected = test.append_child("expected");
            ParserSnapshotTest::EncodeScript(expected, *scanned.first, *parsed, input_buffer);
        }

        // Write xml document
        doc.save(outs, "    ", pugi::format_default | pugi::format_no_declaration);
    }
}

static std::unique_ptr<Script> read_script(pugi::xml_node node, size_t entry_id, Catalog& catalog) {
    auto input = node.child("input").last_child().value();
    auto script = std::make_unique<Script>(catalog, entry_id);
    script->InsertTextAt(0, input);
    if (auto status = script->Scan(); status != buffers::status::StatusCode::OK) {
        std::cout << "  ERROR " << buffers::status::EnumNameStatusCode(status) << std::endl;
        return nullptr;
    }
    if (auto status = script->Parse(); status != buffers::status::StatusCode::OK) {
        std::cout << "  ERROR " << buffers::status::EnumNameStatusCode(status) << std::endl;
        return nullptr;
    }
    if (auto status = script->Analyze(); status != buffers::status::StatusCode::OK) {
        std::cout << "  ERROR " << buffers::status::EnumNameStatusCode(status) << std::endl;
        return nullptr;
    }
    return script;
}

static std::unique_ptr<Catalog> read_catalog(pugi::xml_node catalog_node,
                                             std::vector<std::unique_ptr<Script>>& catalog_scripts, size_t& entry_id) {
    auto catalog = std::make_unique<Catalog>();
    for (auto entry_node : catalog_node.children()) {
        std::string entry_name = entry_node.name();

        if (entry_name == "script") {
            auto external_id = entry_id++;
            auto script = read_script(entry_node, external_id, *catalog);
            catalog->LoadScript(*script, external_id);
            AnalyzerSnapshotTest::EncodeScript(entry_node, *script->analyzed_script, false);
            catalog_scripts.push_back(std::move(script));
        }
    }
    return catalog;
}

static void generate_analyzer_snapshots(const std::filesystem::path& snapshot_dir) {
    for (auto& p : std::filesystem::directory_iterator(snapshot_dir)) {
        auto filename = p.path().filename().filename().string();

        // Is template file file
        auto out = p.path();
        if (out.extension() != ".xml") continue;
        out.replace_extension();
        if (out.extension() != ".tpl") continue;
        out.replace_extension(".xml");

        // Open input stream
        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << filename << "] failed to read file" << std::endl;
            continue;
        }

        // Open output stream
        std::cout << "FILE " << out << std::endl;
        std::ofstream outs;
        outs.open(out, std::ofstream::out | std::ofstream::trunc);

        // Parse xml document
        pugi::xml_document doc;
        doc.load(in, pugi::parse_default | pugi::parse_comments);
        auto root = doc.child("analyzer-snapshots");

        for (auto test_node : root.children()) {
            if (test_node.type() != pugi::node_element) continue;
            auto name = test_node.attribute("name").as_string();
            std::cout << "  TEST " << name << std::endl;

            std::unique_ptr<Catalog> catalog;
            std::vector<std::unique_ptr<Script>> catalog_scripts;
            size_t entry_id = 1;
            catalog = read_catalog(test_node.child("catalog"), catalog_scripts, entry_id);
            auto main_node = test_node.child("script");
            auto main_script = read_script(main_node, 0, *catalog);

            AnalyzerSnapshotTest::EncodeScript(main_node, *main_script->analyzed_script, true);
        }

        // Write xml document
        doc.save(outs, "    ", pugi::format_default | pugi::format_no_declaration);
    }
}

static void generate_registry_snapshots(const std::filesystem::path& snapshot_dir) {
    for (auto& p : std::filesystem::directory_iterator(snapshot_dir)) {
        auto filename = p.path().filename().filename().string();

        // Is template file file
        auto out = p.path();
        if (out.extension() != ".xml") continue;
        out.replace_extension();
        if (out.extension() != ".tpl") continue;
        out.replace_extension(".xml");

        // Open input stream
        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << filename << "] failed to read file" << std::endl;
            continue;
        }

        // Open output stream
        std::cout << "FILE " << out << std::endl;
        std::ofstream outs;
        outs.open(out, std::ofstream::out | std::ofstream::trunc);

        // Parse xml document
        pugi::xml_document doc;
        doc.load(in, pugi::parse_default | pugi::parse_comments);
        auto root = doc.child("registry-snapshots");

        for (auto test : root.children()) {
            if (test.type() != pugi::node_element) continue;
            auto name = test.attribute("name").as_string();
            std::cout << "  TEST " << name << std::endl;

            // Read catalog.
            // Leave the catalog unique ptr before the script vector to make sure scripts are dropped from the catalog
            // first.
            std::unique_ptr<Catalog> catalog;
            std::vector<std::unique_ptr<Script>> catalog_scripts;
            size_t next_entry_id = 1;
            catalog = read_catalog(test.child("catalog"), catalog_scripts, next_entry_id);

            // Read registry
            auto registry_node = test.child("registry");
            std::vector<std::unique_ptr<Script>> registry_scripts;
            for (auto script_node : registry_node.children()) {
                auto script = read_script(script_node, next_entry_id++, *catalog);
                AnalyzerSnapshotTest::EncodeScript(script_node, *script->analyzed_script, false);
                registry_scripts.push_back(std::move(script));
            }

            // Add registry scripts
            ScriptRegistry registry;
            for (auto& script : registry_scripts) {
                registry.AddScript(*script);
            }
        }

        // Write xml document
        doc.save(outs, "    ", pugi::format_default | pugi::format_no_declaration);
    }
}

static void generate_completion_snapshots(const std::filesystem::path& snapshot_dir) {
    for (auto& p : std::filesystem::directory_iterator(snapshot_dir)) {
        auto filename = p.path().filename().filename().string();

        // Is template file file
        auto out = p.path();
        if (out.extension() != ".xml") continue;
        out.replace_extension();
        if (out.extension() != ".tpl") continue;
        out.replace_extension(".xml");

        // Open input stream
        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << filename << "] failed to read file" << std::endl;
            continue;
        }

        // Open output stream
        std::cout << "FILE " << out << std::endl;
        std::ofstream outs;
        outs.open(out, std::ofstream::out | std::ofstream::trunc);

        // Parse xml document
        pugi::xml_document doc;
        doc.load(in, pugi::parse_default | pugi::parse_comments);
        auto root = doc.child("completion-snapshots");

        for (auto test : root.children()) {
            if (test.type() != pugi::node_element) continue;
            auto name = test.attribute("name").as_string();
            std::cout << "  TEST " << name << std::endl;

            // Read catalog.
            // Leave the catalog unique ptr before the script vector to make sure scripts are dropped from the catalog
            // first.
            std::unique_ptr<Catalog> catalog;
            std::vector<std::unique_ptr<Script>> catalog_scripts;
            size_t next_entry_id = 1;
            catalog = read_catalog(test.child("catalog"), catalog_scripts, next_entry_id);

            // Read registry
            auto registry_node = test.child("registry");
            std::vector<std::unique_ptr<Script>> registry_scripts;
            for (auto script_node : registry_node.children()) {
                auto script = read_script(script_node, next_entry_id++, *catalog);
                AnalyzerSnapshotTest::EncodeScript(script_node, *script->analyzed_script, false);
                registry_scripts.push_back(std::move(script));
            }

            // Add registry scripts
            ScriptRegistry registry;
            for (auto& script : registry_scripts) {
                registry.AddScript(*script);
            }

            // Read main script
            auto editor_node = test.child("editor");
            auto editor_script = read_script(editor_node, 0, *catalog);
            AnalyzerSnapshotTest::EncodeScript(editor_node, *editor_script->analyzed_script, true);

            auto cursor_node = test.child("cursor");
            auto cursor_search_node = cursor_node.child("search");
            auto cursor_search_text = cursor_search_node.attribute("text").value();
            auto cursor_search_index = cursor_search_node.attribute("index").as_int();

            std::string_view target_text = editor_script->scanned_script->GetInput();
            auto search_pos = target_text.find(cursor_search_text);
            if (search_pos == std::string_view::npos) {
                std::cout << "  ERROR couldn't locate cursor `" << cursor_search_text << "`" << std::endl;
                continue;
            }
            auto cursor_pos = search_pos + cursor_search_index;
            if (cursor_pos > target_text.size()) {
                std::cout << "  ERROR cursor index out of bounds " << cursor_pos << " > " << target_text.size()
                          << std::endl;
                continue;
            }

            auto completions_node = test.child("completions");
            auto limit = completions_node.attribute("limit").as_int(100);

            editor_script->MoveCursor(cursor_pos);
            auto [completion, completion_status] = editor_script->CompleteAtCursor(limit, &registry);
            if (completion_status != buffers::status::StatusCode::OK) {
                std::cout << "  ERROR " << buffers::status::EnumNameStatusCode(completion_status) << std::endl;
                continue;
            }

            CompletionSnapshotTest::EncodeCompletion(completions_node, *completion);

            auto& cursor = completion->GetCursor();
            EncodeLocation(completions_node, completion->GetTargetSymbol()->symbol.location, target_text);
        }

        // Write xml document
        doc.save(outs, "    ", pugi::format_default | pugi::format_no_declaration);
    }
}

static void generate_planviewmodel_snapshots(const std::filesystem::path& snapshot_dir) {
    for (auto& p : std::filesystem::directory_iterator(snapshot_dir)) {
        auto filename = p.path().filename().filename().string();

        // Is template file file
        auto out = p.path();
        if (out.extension() != ".xml") continue;
        out.replace_extension();
        if (out.extension() != ".tpl") continue;
        out.replace_extension(".xml");

        // Open input stream
        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << filename << "] failed to read file" << std::endl;
            continue;
        }

        // Open output stream
        std::cout << "FILE " << out << std::endl;
        std::ofstream outs;
        outs.open(out, std::ofstream::out | std::ofstream::trunc);

        // Parse xml document
        pugi::xml_document doc;
        doc.load(in, pugi::parse_default | pugi::parse_comments);
        auto root = doc.child("plan-snapshots");

        for (auto test : root.children()) {
            if (test.type() != pugi::node_element) continue;
            auto name = test.attribute("name").as_string();
            std::cout << "  TEST " << name << std::endl;

            /// Parse plan
            auto input = test.child("input");
            auto input_buffer = std::string{input.last_child().value()};

            /// Parse the hyper plan
            PlanViewModel view_model;
            auto status = view_model.ParseHyperPlan(std::move(input_buffer));
            if (status != buffers::status::StatusCode::OK) {
                std::cout << "  ERROR " << buffers::status::EnumNameStatusCode(status) << std::endl;
                continue;
            }

            // Compute the plan layout
            buffers::view::PlanLayoutConfig config;
            config.mutate_level_height(64.0);
            config.mutate_node_height(32.0);
            config.mutate_node_margin_horizontal(20.0);
            config.mutate_node_padding_left(8.0);
            config.mutate_node_padding_right(8.0);
            config.mutate_icon_width(14.0);
            config.mutate_icon_margin_right(8.0);
            config.mutate_max_label_chars(20);
            config.mutate_width_per_label_char(8.5);
            config.mutate_node_min_width(0);
            view_model.Configure(config);

            // Compute the layout
            view_model.ComputeLayout();

            /// Write output
            PlanViewModelSnapshotTest::EncodePlanViewModel(test, view_model);
        }

        // Write xml document
        doc.save(outs, "    ", pugi::format_default | pugi::format_no_declaration);
    }
}

static void generate_formatter_snapshots(const std::filesystem::path& snapshot_dir) {
    for (auto& p : std::filesystem::directory_iterator(snapshot_dir)) {
        auto filename = p.path().filename().filename().string();

        // Is template file file
        auto out = p.path();
        if (out.extension() != ".xml") continue;
        out.replace_extension();
        if (out.extension() != ".tpl") continue;
        out.replace_extension(".xml");

        // Open input stream
        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << filename << "] failed to read file" << std::endl;
            continue;
        }

        // Open output stream
        std::cout << "FILE " << out << std::endl;
        std::ofstream outs;
        outs.open(out, std::ofstream::out | std::ofstream::trunc);

        // Parse xml document
        pugi::xml_document doc;
        doc.load(in, pugi::parse_default | pugi::parse_comments);
        auto root = doc.child("formatter-snapshots");

        for (auto test : root.children()) {
            if (test.type() != pugi::node_element) continue;
            // Copy expected
            auto name = test.attribute("name").as_string();
            std::cout << "  TEST " << name << std::endl;

            /// Parse module
            auto input = test.child("input");
            std::string input_buffer{trim_view(input.last_child().value(), is_no_space)};
            rope::Rope input_rope{1024, input_buffer};
            auto scanned = parser::Scanner::Scan(input_rope, 0, 1);
            if (scanned.second != buffers::status::StatusCode::OK) {
                std::cout << "  ERROR " << buffers::status::EnumNameStatusCode(scanned.second) << std::endl;
                continue;
            }
            auto [parsed, parserError] = parser::Parser::Parse(scanned.first);

            // Format the AST once, then fill each <formatted> tag with its mode/indent
            Formatter formatter{parsed};
            for (auto formatted_node : test.children("formatted")) {
                FormattingConfig config;
                config.mode = ParseFormattingMode(formatted_node.attribute("mode").as_string("compact"));
                config.indentation_width =
                    formatted_node.attribute("indent").as_uint(FORMATTING_DEFAULT_INDENTATION_WIDTH);
                std::string formatted = formatter.Format(config);
                formatted_node.text().set(formatted.data(), formatted.size());
                auto mode = FormattingModeToString(config.mode);
                if (formatted_node.attribute("mode")) {
                    formatted_node.attribute("mode").set_value(mode.data(), mode.size());
                } else {
                    formatted_node.append_attribute("mode").set_value(mode.data(), mode.size());
                }
                if (formatted_node.attribute("indent")) {
                    formatted_node.attribute("indent").set_value(static_cast<unsigned>(config.indentation_width));
                } else {
                    formatted_node.append_attribute("indent").set_value(
                        static_cast<unsigned>(config.indentation_width));
                }
            }
        }

        // Write xml document
        doc.save(outs, "    ", pugi::format_default | pugi::format_no_declaration);
    }
}

int main(int argc, char* argv[]) {
    gflags::SetUsageMessage("Usage: ./snapshot_parser --source_dir <dir>");
    gflags::ParseCommandLineFlags(&argc, &argv, false);

    if (!std::filesystem::exists(FLAGS_source_dir)) {
        std::cout << "Invalid source directory: " << FLAGS_source_dir << std::endl;
    }
    auto source_dir = std::filesystem::path{FLAGS_source_dir};
    generate_parser_snapshots(source_dir / "snapshots" / "parser");
    generate_analyzer_snapshots(source_dir / "snapshots" / "analyzer");
    generate_completion_snapshots(source_dir / "snapshots" / "completion");
    generate_registry_snapshots(source_dir / "snapshots" / "registry");
    generate_planviewmodel_snapshots(source_dir / "snapshots" / "plans" / "hyper" / "tests");
    generate_formatter_snapshots(source_dir / "snapshots" / "formatter");
    return 0;
}
