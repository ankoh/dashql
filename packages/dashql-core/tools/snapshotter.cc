#include <deque>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "c4/yml/emit.hpp"
#include "c4/yml/std/std.hpp"
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
#include "dashql/testing/yaml_tests.h"
#include "dashql/utils/string_trimming.h"
#include "dashql/view/plan_view_model.h"
#include "gflags/gflags.h"
#include "ryml.hpp"

using namespace dashql;
using namespace dashql::testing;

DEFINE_string(source_dir, "", "Source directory");

static void generate_parser_snapshots(const std::filesystem::path& snapshot_dir) {
    for (auto& p : std::filesystem::directory_iterator(snapshot_dir)) {
        auto path = p.path();
        if (path.extension() != ".yaml") continue;
        auto stem = path.stem().string();

        // Is a template?
        const bool is_tpl = (path.stem().extension() == ".tpl");
        if (!is_tpl) continue;

        // stem is e.g. "simple.tpl", output is simple.yaml
        auto out = path;
        out.replace_extension();
        out.replace_extension(".yaml");  // simple.tpl.yaml -> simple.yaml

        std::ifstream in(path, std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << path.filename().string() << "] failed to read file" << std::endl;
            continue;
        }
        std::stringstream buf;
        buf << in.rdbuf();
        std::string content = buf.str();

        // Parse the yaml
        c4::yml::Tree tpl_tree;
        c4::yml::parse_in_arena(c4::to_csubstr(content), &tpl_tree);
        auto root = tpl_tree.rootref();
        if (!root.has_child("parser-snapshots")) {
            std::cout << "[" << path.filename().string() << "] no parser-snapshots key" << std::endl;
            continue;
        }

        std::cout << "FILE " << out << std::endl;
        c4::yml::Tree out_tree;
        auto out_root = out_tree.rootref();
        out_root.set_type(c4::yml::MAP);
        auto snapshots_node = out_root.append_child();
        snapshots_node << c4::yml::key("parser-snapshots");
        snapshots_node |= c4::yml::SEQ;

        auto tpl_snapshots = root["parser-snapshots"];
        for (auto test_node : tpl_snapshots.children()) {
            std::string name;
            if (test_node.has_child("name")) {
                c4::csubstr v = test_node["name"].val();
                if (v.str) name.assign(v.str, v.len);
            }
            std::string input_buffer;
            if (test_node.has_child("input")) {
                c4::csubstr v = test_node["input"].val();
                if (v.str) {
                    std::string_view trimmed = trim_view(std::string_view{v.str, v.len}, is_no_space);
                    input_buffer.assign(trimmed.data(), trimmed.size());
                }
            }
            bool debug = false;
            if (test_node.has_child("debug")) {
                c4::csubstr v = test_node["debug"].val();
                debug = (v == "true" || v == "1");
            }
            std::cout << "  TEST " << name << std::endl;

            rope::Rope input_rope{1024, input_buffer};
            auto scanned = parser::Scanner::Scan(input_rope, 0, 1);
            if (scanned.second != buffers::status::StatusCode::OK) {
                std::cout << "  ERROR " << buffers::status::EnumNameStatusCode(scanned.second) << std::endl;
                continue;
            }
            auto [parsed, parserError] = parser::Parser::Parse(scanned.first);

            auto item = snapshots_node.append_child();
            item.set_type(c4::yml::MAP);
            item.append_child() << c4::yml::key("name") << name;

            auto input_node = item.append_child();
            input_node << c4::yml::key("input") << input_buffer;
            input_node.set_val_style(c4::yml::VAL_LITERAL);

            if (debug) item.append_child() << c4::yml::key("debug") << "true";
            auto expected_node = item.append_child();
            expected_node << c4::yml::key("expected");
            expected_node |= c4::yml::MAP;

            ParserSnapshotTest::EncodeScript(expected_node, *scanned.first, *parsed, input_buffer);
        }

        // Emit from the first child (parser-snapshots) so output is a single doc with one top-level key.
        // rapidyaml's emitter is recursive: each container does ++depth, recurse, --depth. So deep ASTs
        // (e.g. tpcds) need max_depth well above the default (64) or emit fails
        c4::yml::NodeRef to_emit = out_tree.ref(out_tree.first_child(out_tree.root_id()));
        std::string emitted = c4::yml::emitrs_yaml<std::string>(to_emit, c4::yml::EmitOptions().max_depth(128));
        InjectBlankLinesInSnapshot(emitted);
        std::ofstream outs(out, std::ofstream::out | std::ofstream::trunc);
        outs << emitted;
    }
}

static std::unique_ptr<Script> read_script_yml(c4::yml::ConstNodeRef node, size_t entry_id, Catalog& catalog) {
    std::string input;
    if (node.has_child("input")) {
        c4::csubstr v = node["input"].val();
        if (v.str) {
            std::string_view trimmed = trim_view(std::string_view{v.str, v.len}, is_no_space);
            input.assign(trimmed.data(), trimmed.size());
        }
    }
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

static std::unique_ptr<Catalog> read_catalog_yml(c4::yml::Tree& tree, c4::yml::NodeRef catalog_node,
                                                 std::vector<std::unique_ptr<Script>>& catalog_scripts,
                                                 size_t& entry_id) {
    auto catalog = std::make_unique<Catalog>();
    if (catalog_node.has_child("script")) {
        auto script_node = catalog_node["script"];
        auto script_ref = tree.ref(script_node.id());
        auto external_id = entry_id++;
        auto script = read_script_yml(script_node, external_id, *catalog);
        if (script) {
            catalog->LoadScript(*script, external_id);
            AnalyzerSnapshotTest::EncodeScript(script_ref, *script->analyzed_script, false);
            catalog_scripts.push_back(std::move(script));
        }
    }
    return catalog;
}

static void generate_analyzer_snapshots(const std::filesystem::path& snapshot_dir) {
    for (auto& p : std::filesystem::directory_iterator(snapshot_dir)) {
        auto path = p.path();
        if (path.extension() != ".yaml") continue;
        auto stem = path.stem().string();
        const bool is_tpl = (path.stem().extension() == ".tpl");
        if (!is_tpl) continue;

        auto out = path;
        out.replace_extension();
        out.replace_extension(".yaml");  // basic.tpl.yaml -> basic.yaml

        std::ifstream in(path, std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << path.filename().string() << "] failed to read file" << std::endl;
            continue;
        }
        std::stringstream buf;
        buf << in.rdbuf();
        std::string content = buf.str();

        c4::yml::Tree tree;
        c4::yml::parse_in_arena(c4::to_csubstr(content), &tree);
        auto root = tree.rootref();
        if (!root.has_child("analyzer-snapshots")) {
            std::cout << "[" << path.filename().string() << "] no analyzer-snapshots key" << std::endl;
            continue;
        }

        std::cout << "FILE " << out << std::endl;
        auto snapshots = root["analyzer-snapshots"];
        for (auto test_node : snapshots.children()) {
            if (!test_node.has_child("name")) continue;
            c4::csubstr name_v = test_node["name"].val();
            std::string name = name_v.str ? std::string(name_v.str, name_v.len) : std::string();
            std::cout << "  TEST " << name << std::endl;

            std::unique_ptr<Catalog> catalog;
            std::vector<std::unique_ptr<Script>> catalog_scripts;
            size_t entry_id = 1;
            if (test_node.has_child("catalog")) {
                auto catalog_node = tree.ref(test_node["catalog"].id());
                catalog = read_catalog_yml(tree, catalog_node, catalog_scripts, entry_id);
            } else {
                catalog = std::make_unique<Catalog>();
            }
            if (!test_node.has_child("script")) continue;
            auto script_node = test_node["script"];
            auto script_ref = tree.ref(script_node.id());
            auto main_script = read_script_yml(script_node, 0, *catalog);
            if (main_script) {
                AnalyzerSnapshotTest::EncodeScript(script_ref, *main_script->analyzed_script, true);
            }
        }

        c4::yml::NodeRef to_emit = tree.ref(tree.first_child(tree.root_id()));
        std::string emitted = c4::yml::emitrs_yaml<std::string>(to_emit, c4::yml::EmitOptions().max_depth(128));
        InjectBlankLinesInSnapshot(emitted);
        std::ofstream outs(out, std::ofstream::out | std::ofstream::trunc);
        outs << emitted;
    }
}

static void generate_registry_snapshots(const std::filesystem::path& snapshot_dir) {
    for (auto& p : std::filesystem::directory_iterator(snapshot_dir)) {
        auto path = p.path();
        if (path.extension() != ".yaml") continue;
        if (path.stem().extension() != ".tpl") continue;

        auto out = path;
        out.replace_extension();
        out.replace_extension(".yaml");

        std::ifstream in(path, std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << path.filename().string() << "] failed to read file" << std::endl;
            continue;
        }
        std::stringstream buf;
        buf << in.rdbuf();
        std::string content = buf.str();

        c4::yml::Tree tree;
        c4::yml::parse_in_arena(c4::to_csubstr(content), &tree);
        auto root = tree.rootref();
        if (!root.has_child("registry-snapshots")) continue;

        std::cout << "FILE " << out << std::endl;
        auto snapshots = root["registry-snapshots"];
        for (auto test_node : snapshots.children()) {
            if (!test_node.has_child("name")) continue;
            c4::csubstr name_v = test_node["name"].val();
            std::string name = name_v.str ? std::string(name_v.str, name_v.len) : std::string();
            std::cout << "  TEST " << name << std::endl;

            std::unique_ptr<Catalog> catalog;
            std::vector<std::unique_ptr<Script>> catalog_scripts;
            size_t next_entry_id = 1;
            if (test_node.has_child("catalog")) {
                auto catalog_node = tree.ref(test_node["catalog"].id());
                catalog = read_catalog_yml(tree, catalog_node, catalog_scripts, next_entry_id);
            } else {
                catalog = std::make_unique<Catalog>();
            }

            if (!test_node.has_child("registry")) continue;
            auto registry_node = tree.ref(test_node["registry"].id());
            std::vector<std::unique_ptr<Script>> registry_scripts;
            for (auto entry_item : registry_node.children()) {
                if (!entry_item.has_child("script")) continue;
                auto script_node = entry_item["script"];
                auto script = read_script_yml(script_node, next_entry_id++, *catalog);
                if (script) {
                    auto script_ref = tree.ref(script_node.id());
                    script_ref.clear_val();
                    script_ref |= c4::yml::MAP;  // add MAP (keep KEY); EncodeScript needs a container
                    AnalyzerSnapshotTest::EncodeScript(script_ref, *script->analyzed_script, false);
                    registry_scripts.push_back(std::move(script));
                }
            }
        }

        c4::yml::NodeRef to_emit = tree.ref(tree.first_child(tree.root_id()));
        std::string emitted = c4::yml::emitrs_yaml<std::string>(to_emit, c4::yml::EmitOptions().max_depth(128));
        InjectBlankLinesInSnapshot(emitted);
        std::ofstream outs(out, std::ofstream::out | std::ofstream::trunc);
        outs << emitted;
    }
}

static void generate_completion_snapshots(const std::filesystem::path& snapshot_dir) {
    for (auto& p : std::filesystem::directory_iterator(snapshot_dir)) {
        auto path = p.path();
        if (path.extension() != ".yaml") continue;
        if (path.stem().extension() != ".tpl") continue;

        auto out = path;
        out.replace_extension();
        out.replace_extension(".yaml");

        std::ifstream in(path, std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << path.filename().string() << "] failed to read file" << std::endl;
            continue;
        }
        std::stringstream buf;
        buf << in.rdbuf();
        std::string content = buf.str();

        c4::yml::Tree tree;
        c4::yml::parse_in_arena(c4::to_csubstr(content), &tree);
        auto root = tree.rootref();
        if (!root.has_child("completion-snapshots")) continue;

        std::cout << "FILE " << out << std::endl;
        auto snapshots = root["completion-snapshots"];
        for (auto test_node : snapshots.children()) {
            if (!test_node.has_child("name")) continue;
            c4::csubstr name_v = test_node["name"].val();
            std::string name = name_v.str ? std::string(name_v.str, name_v.len) : std::string();
            std::cout << "  TEST " << name << std::endl;

            std::unique_ptr<Catalog> catalog;
            std::vector<std::unique_ptr<Script>> catalog_scripts;
            size_t next_entry_id = 1;
            if (test_node.has_child("catalog")) {
                auto catalog_node = tree.ref(test_node["catalog"].id());
                catalog = read_catalog_yml(tree, catalog_node, catalog_scripts, next_entry_id);
            } else {
                catalog = std::make_unique<Catalog>();
            }

            ScriptRegistry registry;
            std::vector<std::unique_ptr<Script>> registry_scripts;
            if (test_node.has_child("registry")) {
                auto registry_node = tree.ref(test_node["registry"].id());
                for (auto entry_item : registry_node.children()) {
                    if (!entry_item.has_child("script")) continue;
                    auto script_node = entry_item["script"];
                    auto script_ref = tree.ref(script_node.id());
                    script_ref |= c4::yml::MAP;  // was scalar (script text); EncodeScript needs a container
                    auto script = read_script_yml(script_node, next_entry_id++, *catalog);
                    if (script) {
                        AnalyzerSnapshotTest::EncodeScript(script_ref, *script->analyzed_script, false);
                        registry.AddScript(*script);
                        registry_scripts.push_back(std::move(script));
                    }
                }
            }

            if (!test_node.has_child("editor")) continue;
            auto editor_node = test_node["editor"];
            auto editor_script = read_script_yml(editor_node, 0, *catalog);
            if (!editor_script) continue;
            auto editor_ref = tree.ref(editor_node.id());
            editor_ref.clear_val();
            editor_ref |= c4::yml::MAP;  // add MAP (keep KEY); EncodeScript needs a container
            AnalyzerSnapshotTest::EncodeScript(editor_ref, *editor_script->analyzed_script, true);

            std::string cursor_search_text;
            size_t cursor_search_index = 0;
            if (test_node.has_child("cursor") && test_node["cursor"].has_child("search")) {
                auto search = test_node["cursor"]["search"];
                if (search.has_child("text")) {
                    c4::csubstr v = search["text"].val();
                    cursor_search_text = v.str ? std::string(v.str, v.len) : std::string();
                }
                if (search.has_child("index")) {
                    c4::csubstr v = search["index"].val();
                    cursor_search_index = v.str ? static_cast<size_t>(std::atoi(v.str)) : 0;
                }
            }

            std::string_view target_text = editor_script->scanned_script->GetInput();
            auto search_pos = target_text.find(cursor_search_text);
            if (search_pos == std::string_view::npos) {
                std::cout << "  ERROR couldn't locate cursor `" << cursor_search_text << "`" << std::endl;
                continue;
            }
            auto cursor_pos = search_pos + cursor_search_index;
            if (cursor_pos > target_text.size()) {
                std::cout << "  ERROR cursor index out of bounds" << std::endl;
                continue;
            }

            if (!test_node.has_child("completions")) continue;
            size_t limit = 100;
            if (test_node["completions"].has_child("limit")) {
                c4::csubstr v = test_node["completions"]["limit"].val();
                limit = v.str ? static_cast<size_t>(std::atoi(v.str)) : 100;
            }
            auto completions_node = tree.ref(test_node["completions"].id());

            editor_script->MoveCursor(cursor_pos);
            auto [completion, completion_status] = editor_script->CompleteAtCursor(limit, &registry);
            if (completion_status != buffers::status::StatusCode::OK) {
                std::cout << "  ERROR " << buffers::status::EnumNameStatusCode(completion_status) << std::endl;
                continue;
            }

            CompletionSnapshotTest::EncodeCompletion(completions_node, *completion);
            EncodeLocationText(completions_node, completion->GetTargetSymbol()->symbol.location, target_text, "text");
        }

        c4::yml::NodeRef to_emit = tree.ref(tree.first_child(tree.root_id()));
        std::string emitted = c4::yml::emitrs_yaml<std::string>(to_emit, c4::yml::EmitOptions().max_depth(128));
        InjectBlankLinesInSnapshot(emitted);
        std::ofstream outs(out, std::ofstream::out | std::ofstream::trunc);
        outs << emitted;
    }
}

static void generate_planviewmodel_snapshots(const std::filesystem::path& snapshot_dir) {
    for (auto& p : std::filesystem::directory_iterator(snapshot_dir)) {
        auto path = p.path();
        if (path.extension() != ".yaml") continue;
        const bool is_tpl = (path.stem().extension() == ".tpl");
        if (!is_tpl) continue;

        auto out = path;
        out.replace_extension();
        out.replace_extension(".yaml");

        std::ifstream in(path, std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << path.filename().string() << "] failed to read file" << std::endl;
            continue;
        }
        std::stringstream buf;
        buf << in.rdbuf();
        std::string content = buf.str();

        c4::yml::Tree tpl_tree;
        c4::yml::parse_in_arena(c4::to_csubstr(content), &tpl_tree);
        auto tpl_root = tpl_tree.rootref();
        if (!tpl_root.has_child("plan-snapshots")) {
            std::cout << "[" << path.filename().string() << "] no plan-snapshots key" << std::endl;
            continue;
        }

        std::cout << "FILE " << out << std::endl;
        c4::yml::Tree out_tree;
        // Reserve arena so to_arena() never reallocates and invalidates node key/val pointers
        out_tree.reserve_arena(4 * 1024 * 1024);
        auto out_root = out_tree.rootref();
        out_root |= c4::yml::MAP;
        auto out_snapshots =
            out_root.append_child(c4::yml::NodeInit(c4::yml::KEYSEQ, c4::to_csubstr("plan-snapshots")));

        // Keep name/input strings alive until after emit (tree stores csubstr pointers)
        std::deque<std::string> string_storage;
        auto tpl_snapshots = tpl_root["plan-snapshots"];
        for (auto test_node : tpl_snapshots.children()) {
            if (!test_node.has_child("name")) continue;
            c4::csubstr name_v = test_node["name"].val();
            std::string name = name_v.str ? std::string(name_v.str, name_v.len) : std::string();
            std::cout << "  TEST " << name << std::endl;

            if (!test_node.has_child("input")) continue;
            c4::csubstr input_v = test_node["input"].val();
            std::string input_buffer = input_v.str ? std::string(input_v.str, input_v.len) : std::string();
            std::string input_for_yaml = input_buffer;

            PlanViewModel view_model;
            auto status = view_model.ParseHyperPlan(std::move(input_buffer));
            if (status != buffers::status::StatusCode::OK) {
                std::cout << "  ERROR " << buffers::status::EnumNameStatusCode(status) << std::endl;
                continue;
            }

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
            view_model.ComputeLayout();

            string_storage.push_back(name);
            string_storage.push_back(input_for_yaml);
            const std::string& name_ref = string_storage[string_storage.size() - 2];
            const std::string& input_ref = string_storage[string_storage.size() - 1];

            // Create sequence element as MAP in one step (avoid unkeyed node)
            auto test_ref = out_snapshots.append_child(c4::yml::NodeInit(c4::yml::MAP));
            // Use tree arena for scalars; set key then val on same node (emitter requires has_key)
            c4::yml::Tree* tr = out_root.tree();
            auto n_name = test_ref.append_child();
            n_name.set_key(c4::to_csubstr("name"));
            n_name.set_val(tr->to_arena(c4::to_csubstr(name_ref)));
            auto n_input = test_ref.append_child();
            n_input.set_key(c4::to_csubstr("input"));
            n_input.set_val(tr->to_arena(c4::to_csubstr(input_ref)));
            PlanViewModelSnapshotTest::EncodePlanViewModel(test_ref, view_model);
        }

        c4::yml::id_type snap_id = out_tree.first_child(out_tree.root_id());
        c4::yml::NodeRef to_emit = out_tree.ref(snap_id);
        std::string emitted = c4::yml::emitrs_yaml<std::string>(to_emit, c4::yml::EmitOptions().max_depth(128));
        InjectBlankLinesInSnapshot(emitted);
        std::ofstream outs(out, std::ofstream::out | std::ofstream::trunc);
        outs << emitted;
    }
}

static void generate_formatter_snapshots(const std::filesystem::path& snapshot_dir) {
    for (auto& p : std::filesystem::directory_iterator(snapshot_dir)) {
        auto path = p.path();
        if (path.extension() != ".yaml") continue;
        if (path.stem().extension() != ".tpl") continue;

        auto out = path;
        out.replace_extension();
        out.replace_extension(".yaml");

        std::ifstream in(path, std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << path.filename().string() << "] failed to read file" << std::endl;
            continue;
        }
        std::stringstream buf;
        buf << in.rdbuf();
        std::string content = buf.str();

        c4::yml::Tree tree;
        c4::yml::parse_in_arena(c4::to_csubstr(content), &tree);
        auto root = tree.rootref();
        if (!root.has_child("formatter-snapshots")) {
            std::cout << "[" << path.filename().string() << "] no formatter-snapshots key" << std::endl;
            continue;
        }

        // Reserve arena for new "expected" strings so to_arena() does not reallocate
        tree.reserve_arena(content.size() + 64 * 1024);

        std::cout << "FILE " << out << std::endl;
        auto snapshots = root["formatter-snapshots"];
        for (auto test_node : snapshots.children()) {
            if (!test_node.has_child("name") || !test_node.has_child("input")) continue;
            c4::csubstr name_v = test_node["name"].val();
            std::string name = name_v.str ? std::string(name_v.str, name_v.len) : std::string();
            std::cout << "  TEST " << name << std::endl;

            c4::csubstr input_v = test_node["input"].val();
            std::string input_buffer =
                input_v.str ? std::string(trim_view(std::string_view{input_v.str, input_v.len}, is_no_space))
                            : std::string();
            rope::Rope input_rope{1024, input_buffer};
            auto scanned = parser::Scanner::Scan(input_rope, 0, 1);
            if (scanned.second != buffers::status::StatusCode::OK) {
                std::cout << "  ERROR " << buffers::status::EnumNameStatusCode(scanned.second) << std::endl;
                continue;
            }
            auto [parsed, parserError] = parser::Parser::Parse(scanned.first);

            Formatter formatter{parsed};
            if (!test_node.has_child("formatted")) continue;
            for (auto formatted_node : test_node["formatted"].children()) {
                FormattingConfig config;
                config.mode =
                    ParseFormattingMode(formatted_node.has_child("mode") ? std::string(formatted_node["mode"].val().str,
                                                                                       formatted_node["mode"].val().len)
                                                                         : std::string("compact"));
                config.indentation_width = formatted_node.has_child("indent")
                                               ? static_cast<size_t>(std::atoi(formatted_node["indent"].val().str))
                                               : FORMATTING_DEFAULT_INDENTATION_WIDTH;
                std::string formatted = formatter.Format(config);

                c4::yml::NodeRef expected_node = formatted_node["expected"];
                if (expected_node.invalid()) {
                    expected_node = formatted_node.append_child();
                    expected_node << c4::yml::key("expected");
                }
                expected_node.set_val(tree.to_arena(c4::to_csubstr(formatted)));

                std::string mode_str{FormattingModeToString(config.mode)};
                c4::yml::NodeRef mode_node = formatted_node["mode"];
                if (mode_node.invalid()) {
                    mode_node = formatted_node.append_child();
                    mode_node << c4::yml::key("mode");
                }
                mode_node.set_val(tree.to_arena(c4::to_csubstr(mode_str)));

                c4::yml::NodeRef indent_node = formatted_node["indent"];
                if (!indent_node.invalid() || config.indentation_width != FORMATTING_DEFAULT_INDENTATION_WIDTH) {
                    if (indent_node.invalid()) {
                        indent_node = formatted_node.append_child();
                        indent_node << c4::yml::key("indent");
                    }
                    std::string indent_str = std::to_string(config.indentation_width);
                    indent_node.set_val(tree.to_arena(c4::to_csubstr(indent_str)));
                }
            }
        }

        c4::yml::NodeRef to_emit = tree.ref(tree.first_child(tree.root_id()));
        std::string emitted = c4::yml::emitrs_yaml<std::string>(to_emit, c4::yml::EmitOptions().max_depth(128));
        InjectBlankLinesInSnapshot(emitted);
        std::ofstream outs(out, std::ofstream::out | std::ofstream::trunc);
        outs << emitted;
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
    generate_formatter_snapshots(source_dir / "snapshots" / "formatter");
    // TODO: rapidyaml emitter asserts has_key(ich) on a map child when emitting plan tree; skip until fixed
    // generate_planviewmodel_snapshots(source_dir / "snapshots" / "plans" / "hyper" / "tests");
    return 0;
}
