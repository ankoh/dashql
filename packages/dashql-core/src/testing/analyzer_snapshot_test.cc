#include "dashql/testing/analyzer_snapshot_test.h"

#include <format>
#include <fstream>
#include <sstream>

#include "c4/yml/std/std.hpp"
#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"
#include "dashql/script_snippet.h"
#include "dashql/testing/parser_snapshot_test.h"
#include "dashql/testing/yaml_tests.h"
#include "dashql/utils/string_trimming.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

namespace dashql {

using namespace testing;

/// Helper template for static_assert in generic visitor
template <typename T> constexpr bool always_false = false;

/// Is a string with all lower-case alphanumeric characters?
static bool isAllLowercaseAlphaNum(std::string_view id) {
    bool all = true;
    for (auto c : id) {
        all &= (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
    }
    return all;
}

/// Write an identifier and quote it, if necessary
static void quoteIdentifier(std::string& buffer, std::string_view name) {
    if (isAllLowercaseAlphaNum(name)) {
        buffer += name;
    } else {
        buffer += '"';
        buffer += name;
        buffer += '"';
    }
}

/// Write all table declarations to YAML (root is a SEQ node)
static void writeTables(c4::yml::NodeRef root, const AnalyzedScript& target) {
    target.GetTables().ForEach([&](size_t ti, const CatalogEntry::TableDeclaration& table_decl) {
        auto [db_id, schema_id] = table_decl.catalog_schema_id.UnpackSchemaID();
        auto table_id = table_decl.object_id.UnpackTableID();
        std::string table_catalog_id = std::format("{}.{}.{}", db_id, schema_id, table_id.Pack());

        auto yml_tbl = root.append_child();
        yml_tbl.set_type(c4::yml::MAP);
        auto id_node = yml_tbl.append_child();
        id_node << c4::yml::key("id") << table_catalog_id;
        id_node.set_val_style(c4::yml::VAL_DQUO);  // quote so YAML does not parse as float
        std::string table_name{table_decl.table_name.table_name.get().text};
        yml_tbl.append_child() << c4::yml::key("name") << table_name;
        assert(table_decl.ast_node_id.has_value());
        EncodeLocationText(yml_tbl, target.parsed_script->nodes[*table_decl.ast_node_id].location(),
                      target.parsed_script->scanned_script->GetInput());
        // Write child columns
        auto columns_node = yml_tbl.append_child();
        columns_node << c4::yml::key("columns");
        columns_node |= c4::yml::SEQ;
        for (size_t i = 0; i < table_decl.table_columns.size(); ++i) {
            auto& column_decl = table_decl.table_columns[i];
            auto yml_col = columns_node.append_child();
            yml_col.set_type(c4::yml::MAP);
            std::string column_catalog_id = std::format("{}.{}", table_catalog_id, i);
            auto col_id_node = yml_col.append_child();
            col_id_node << c4::yml::key("id") << column_catalog_id;
            col_id_node.set_val_style(c4::yml::VAL_DQUO);  // quote so YAML does not parse as float
            if (!column_decl.column_name.get().text.empty()) {
                std::string column_name{column_decl.column_name.get().text};
                yml_col.append_child() << c4::yml::key("name") << column_name;
            } else {
                yml_col.append_child() << c4::yml::key("name") << "?";
            }
            if (auto node_id = column_decl.ast_node_id; node_id.has_value()) {
                EncodeLocationText(yml_col, target.parsed_script->nodes[*node_id].location(),
                              target.parsed_script->scanned_script->GetInput());
            }
        }
    });
}

namespace testing {

void AnalyzerSnapshotTest::ScriptAnalysisSnapshot::ReadFrom(c4::yml::ConstNodeRef script_node) {
    if (script_node.has_child("input")) {
        c4::csubstr v = script_node["input"].val();
        if (v.str) {
            std::string_view trimmed = trim_view(std::string_view{v.str, v.len}, is_no_space);
            input.assign(trimmed.data(), trimmed.size());
        }
    }
}

void AnalyzerSnapshotTest::TestCatalogSnapshot(const std::vector<ScriptAnalysisSnapshot>& snaps,
                                               c4::yml::NodeRef catalog_node, Catalog& catalog,
                                               std::vector<std::unique_ptr<Script>>& catalog_scripts,
                                               size_t& entry_ids) {
    for (size_t i = 0; i < snaps.size(); ++i) {
        auto& entry = snaps[i];
        auto entry_id = entry_ids++;

        // Create a new script
        catalog_scripts.push_back(std::make_unique<Script>(catalog, entry_id));
        auto& script = *catalog_scripts.back();

        // Encode and compare to expected
        auto script_key_node = catalog_node.append_child();
        script_key_node << c4::yml::key("script");
        script_key_node |= c4::yml::MAP;
        TestScriptSnapshot(entry, script_key_node, script, entry_id, false);

        // Add script to catalog.
        catalog.LoadScript(script, entry_id);
    }
}

void AnalyzerSnapshotTest::TestScriptSnapshot(const ScriptAnalysisSnapshot& snap, c4::yml::NodeRef node, Script& script,
                                              size_t entry_id, bool is_main) {
    script.InsertTextAt(entry_id, snap.input);

    ASSERT_EQ(script.Scan(), buffers::status::StatusCode::OK);
    ASSERT_EQ(script.Parse(), buffers::status::StatusCode::OK);
    ASSERT_EQ(script.Analyze(), buffers::status::StatusCode::OK);

    AnalyzerSnapshotTest::EncodeScript(node, *script.analyzed_script, is_main);

    if (snap.tree && snap.node_id != c4::yml::NONE) {
        auto expected = snap.tree->ref(snap.node_id);
        const char* keys[] = {"errors", "tables", "table-refs", "expressions", "constants", "column-computations",
                              "column-filters"};
        for (const char* key : keys) {
            if (!expected.has_child(key)) continue;
            auto have = node[key];
            auto want = expected[key];
            if (have.invalid() && want.invalid()) continue;
            ASSERT_TRUE(Matches(have, want)) << "key: " << key;
        }
    }
}

void operator<<(std::ostream& out, const AnalyzerSnapshotTest& p) { out << p.name; }

void AnalyzerSnapshotTest::EncodeSnippet(c4::yml::NodeRef parent, const AnalyzedScript& analyzed, size_t root_node_id) {
    auto& parsed = *analyzed.parsed_script;
    auto& scanned = *parsed.scanned_script;
    auto& script_text = scanned.text_buffer;
    auto& script_ast = parsed.GetNodes();
    auto& script_markers = analyzed.node_markers;

    auto snippet = ScriptSnippet::Extract(script_text, script_ast, script_markers, root_node_id, scanned.name_registry);
    auto sig_masked = snippet.ComputeSignature(true);
    auto sig_unmasked = snippet.ComputeSignature(false);

    auto out_snippet = parent.append_child();
    out_snippet << c4::yml::key("snippet");
    out_snippet |= c4::yml::MAP;
    out_snippet.append_child() << c4::yml::key("template") << sig_masked;
    out_snippet.append_child() << c4::yml::key("raw") << std::to_string(sig_unmasked);
    out_snippet.append_child() << c4::yml::key("text") << std::string{snippet.text};
    auto out_nodes = out_snippet.append_child();
    out_nodes << c4::yml::key("nodes");
    out_nodes |= c4::yml::MAP;
    out_nodes.append_child() << c4::yml::key("count") << snippet.nodes.size();
    out_nodes.append_child() << c4::yml::key("bytes") << (snippet.nodes.size() * sizeof(buffers::parser::Node));
    ParserSnapshotTest::EncodeAST(out_nodes, snippet.text, snippet.nodes, snippet.root_node_id);
}

void AnalyzerSnapshotTest::EncodeScript(c4::yml::NodeRef out, const AnalyzedScript& script, bool is_main) {
    out.append_child() << c4::yml::key("id") << script.GetCatalogEntryId();

    // Write local declarations
    if (script.GetTables().GetSize() > 0) {
        auto tables_node = out.append_child();
        tables_node << c4::yml::key("tables");
        tables_node |= c4::yml::SEQ;
        writeTables(tables_node, script);
    }
    // Encode errors (flow style when empty so empty seq emits as [] and matches snapshot)
    auto errors_node = out.append_child();
    errors_node << c4::yml::key("errors");
    errors_node |= c4::yml::SEQ;
    if (script.errors.empty()) errors_node.set_container_style(c4::yml::FLOW_SL);
    for (auto& error : script.errors) {
        auto error_node = errors_node.append_child();
        error_node.set_type(c4::yml::MAP);
        error_node.append_child() << c4::yml::key("type")
                                  << std::string(buffers::analyzer::EnumNameAnalyzerErrorType(error.error_type));
        error_node.append_child() << c4::yml::key("message") << error.message;
        EncodeLocationText(error_node, *error.location, script.parsed_script->scanned_script->GetInput());
    }
    // Write table references
    if (!script.table_references.IsEmpty()) {
        auto table_refs_node = out.append_child();
        table_refs_node << c4::yml::key("table-refs");
        table_refs_node |= c4::yml::SEQ;
        script.table_references.ForEach([&](size_t i, const AnalyzedScript::TableReference& ref) {
            auto yml_ref = table_refs_node.append_child();
            yml_ref.set_type(c4::yml::MAP);
            std::visit(
                [&](const auto& value) {
                    using T = std::decay_t<decltype(value)>;
                    if constexpr (std::is_same_v<T, std::monostate>) {
                    } else if constexpr (std::is_same_v<T, AnalyzedScript::TableReference::RelationExpression>) {
                        auto& relation_expr = value;
                        if (!relation_expr.resolved_table.has_value()) {
                            yml_ref.append_child() << c4::yml::key("type") << "name/unresolved";
                        } else {
                            auto& resolved = relation_expr.resolved_table.value();
                            auto [db_id, schema_id] = resolved.catalog_schema_id.UnpackSchemaID();
                            auto table_id = resolved.catalog_table_id.UnpackTableID();
                            std::string catalog_id = std::format("{}.{}.{}", db_id, schema_id, table_id.Pack());
                            auto type = is_main && table_id.GetOrigin() == script.GetCatalogEntryId() ? "name/internal"
                                                                                                      : "name/catalog";
                            yml_ref.append_child() << c4::yml::key("type") << type;
                            auto ref_id_node = yml_ref.append_child();
                            ref_id_node << c4::yml::key("id") << catalog_id;
                            ref_id_node.set_val_style(c4::yml::VAL_DQUO);  // quote so YAML does not parse as float
                        }
                    } else {
                        static_assert(always_false<T>, "Unhandled table reference type in analyzer snapshot test");
                    }
                },
                ref.inner);
            if (ref.ast_statement_id.has_value()) {
                yml_ref.append_child() << c4::yml::key("stmt") << *ref.ast_statement_id;
            }
            EncodeLocationText(yml_ref, script.parsed_script->nodes[ref.ast_node_id].location(),
                          script.parsed_script->scanned_script->GetInput());
        });
    }

    // Write expressions
    if (!script.expressions.IsEmpty()) {
        auto expr_node = out.append_child();
        expr_node << c4::yml::key("expressions");
        expr_node |= c4::yml::SEQ;
        script.expressions.ForEach([&](size_t i, const AnalyzedScript::Expression& ref) {
            auto yml_ref = expr_node.append_child();
            yml_ref.set_type(c4::yml::MAP);
            yml_ref.append_child() << c4::yml::key("id") << i;
            std::visit(
                [&](const auto& value) {
                    using T = std::decay_t<decltype(value)>;
                    if constexpr (std::is_same_v<T, std::monostate>) {
                    } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::ColumnRef>) {
                        auto& column_ref = value;
                        if (!column_ref.resolved_column.has_value()) {
                            yml_ref.append_child() << c4::yml::key("type") << "colref/unresolved";
                        } else {
                            auto& resolved = column_ref.resolved_column.value();
                            auto [db_id, schema_id] = resolved.catalog_schema_id.UnpackSchemaID();
                            auto [table_id, column_idx] = resolved.catalog_table_column_id.UnpackTableColumnID();
                            std::string catalog_id =
                                std::format("{}.{}.{}.{}", db_id, schema_id, table_id.Pack(), column_idx);
                            auto type = (is_main && table_id.GetOrigin() == script.GetCatalogEntryId())
                                            ? "colref/internal"
                                            : "colref/catalog";
                            yml_ref.append_child() << c4::yml::key("type") << type;
                            auto cat_node = yml_ref.append_child();
                            cat_node << c4::yml::key("catalog") << catalog_id;
                            cat_node.set_val_style(c4::yml::VAL_DQUO);  // quote so YAML does not parse as float
                        }
                    } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::Literal>) {
                        auto& literal = value;
                        std::string type_name = "literal/";
                        switch (literal.literal_type) {
                            case dashql::buffers::algebra::LiteralType::NULL_:
                                type_name += "null";
                                break;
                            case dashql::buffers::algebra::LiteralType::INTERVAL:
                                type_name += "interval";
                                break;
                            case dashql::buffers::algebra::LiteralType::INTEGER:
                                type_name += "integer";
                                break;
                            case dashql::buffers::algebra::LiteralType::FLOAT:
                                type_name += "float";
                                break;
                            case dashql::buffers::algebra::LiteralType::STRING:
                                type_name += "string";
                                break;
                        }
                        yml_ref.append_child() << c4::yml::key("type") << type_name;
                    } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::Comparison>) {
                        auto& cmp = value;
                        yml_ref.append_child() << c4::yml::key("type") << "comparison";
                        auto* op_tt = buffers::algebra::ComparisonFunctionTypeTable();
                        yml_ref.append_child() << c4::yml::key("op")
                                                << std::string(op_tt->names[static_cast<uint8_t>(cmp.func)]);
                        yml_ref.append_child() << c4::yml::key("left") << cmp.left_expression_id;
                        yml_ref.append_child() << c4::yml::key("right") << cmp.right_expression_id;
                    } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::BinaryExpression>) {
                        auto& binary = value;
                        yml_ref.append_child() << c4::yml::key("type") << "binary";
                        auto* op_tt = buffers::algebra::BinaryExpressionFunctionTypeTable();
                        yml_ref.append_child() << c4::yml::key("op")
                                                << std::string(op_tt->names[static_cast<uint8_t>(binary.func)]);
                        yml_ref.append_child() << c4::yml::key("left") << binary.left_expression_id;
                        yml_ref.append_child() << c4::yml::key("right") << binary.right_expression_id;
                    } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::FunctionCallExpression>) {
                        auto& func = value;
                        yml_ref.append_child() << c4::yml::key("type") << "func";
                        std::visit(
                            [&](const auto& func_name_value) {
                                using FuncT = std::decay_t<decltype(func_name_value)>;
                                if constexpr (std::is_same_v<FuncT, buffers::parser::KnownFunction>) {
                                    auto known = func_name_value;
                                    auto known_name =
                                        buffers::parser::KnownFunctionTypeTable()->names[static_cast<size_t>(known)];
                                    yml_ref.append_child() << c4::yml::key("known") << std::string(known_name);
                                } else if constexpr (std::is_same_v<FuncT, CatalogEntry::QualifiedFunctionName>) {
                                    yml_ref.append_child() << c4::yml::key("name") << func_name_value.getDebugString();
                                } else {
                                    static_assert(always_false<FuncT>,
                                                  "Unhandled function name type in analyzer snapshot test");
                                }
                            },
                            func.function_name);
                    } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::ConstIntervalCast>) {
                        yml_ref.append_child() << c4::yml::key("type") << "constcast/interval";
                    } else {
                        static_assert(always_false<T>, "Unhandled expression type in analyzer snapshot test");
                    }
                },
                ref.inner);
            if (ref.is_constant_expression) {
                yml_ref.append_child() << c4::yml::key("const") << ref.is_constant_expression;
            }
            if (ref.is_column_filter && ref.target_expression_id.has_value()) {
                yml_ref.append_child() << c4::yml::key("restrict") << ref.target_expression_id.value();
            }
            if (ref.is_column_computation && ref.target_expression_id.has_value()) {
                yml_ref.append_child() << c4::yml::key("computation") << ref.target_expression_id.value();
            }
            if (ref.ast_statement_id.has_value()) {
                yml_ref.append_child() << c4::yml::key("stmt") << *ref.ast_statement_id;
            }
            EncodeLocationText(yml_ref, script.parsed_script->nodes[ref.ast_node_id].location(),
                          script.parsed_script->scanned_script->GetInput());
        });
    }

    // Write constant expressions
    if (!script.constant_expressions.IsEmpty()) {
        auto list_node = out.append_child();
        list_node << c4::yml::key("constants");
        list_node |= c4::yml::SEQ;
        script.constant_expressions.ForEach([&](size_t _i, const AnalyzedScript::ConstantExpression& constant) {
            auto yml_ref = list_node.append_child();
            yml_ref.set_type(c4::yml::MAP);
            yml_ref.append_child() << c4::yml::key("expr") << constant.root.get().expression_id;
            EncodeLocationText(yml_ref, script.parsed_script->nodes[constant.root.get().ast_node_id].location(),
                          script.parsed_script->scanned_script->GetInput());
            if (!constant.root.get().IsLiteral()) {
                EncodeSnippet(yml_ref, script, constant.root.get().ast_node_id);
            }
        });
    }
    // Write computations
    if (!script.column_computations.IsEmpty()) {
        auto list_node = out.append_child();
        list_node << c4::yml::key("column-computations");
        list_node |= c4::yml::SEQ;
        script.column_computations.ForEach([&](size_t _i, const AnalyzedScript::ColumnComputation& computation) {
            auto yml_ref = list_node.append_child();
            yml_ref.set_type(c4::yml::MAP);
            yml_ref.append_child() << c4::yml::key("expr") << computation.root.get().expression_id;
            EncodeSnippet(yml_ref, script, computation.root.get().ast_node_id);
        });
    }
    // Write filters
    if (!script.column_filters.IsEmpty()) {
        auto list_node = out.append_child();
        list_node << c4::yml::key("column-filters");
        list_node |= c4::yml::SEQ;
        script.column_filters.ForEach([&](size_t _i, const AnalyzedScript::ColumnFilter& filter) {
            auto yml_ref = list_node.append_child();
            yml_ref.set_type(c4::yml::MAP);
            yml_ref.append_child() << c4::yml::key("expr") << filter.root.get().expression_id;
            EncodeSnippet(yml_ref, script, filter.root.get().ast_node_id);
        });
    }
}

struct AnalyzerSnapshotFile {
    std::string content;
    c4::yml::Tree tree;
    std::vector<AnalyzerSnapshotTest> tests;
};
static std::unordered_map<std::string, AnalyzerSnapshotFile> TEST_FILES;

/// Get the grammar tests
void AnalyzerSnapshotTest::LoadTests(const std::filesystem::path& snapshots_dir) {
    std::cout << "Loading analyzer tests at: " << snapshots_dir << std::endl;

    for (auto& p : std::filesystem::directory_iterator(snapshots_dir)) {
        auto filename = p.path().filename().string();
        if (p.path().extension().string() != ".yaml") continue;

        // Skip template outputs (e.g. basic.tpl.yaml)
        if (filename.find(".tpl.") != std::string::npos) continue;

        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[ SETUP    ] failed to read test file: " << filename << std::endl;
            continue;
        }
        std::stringstream buf;
        buf << in.rdbuf();
        std::string content = buf.str();

        AnalyzerSnapshotFile file;
        file.content = std::move(content);
        c4::yml::parse_in_arena(c4::to_csubstr(file.content), &file.tree);

        auto root = file.tree.rootref();
        if (!root.has_child("analyzer-snapshots")) {
            std::cout << "[ SETUP    ] " << filename << ": no analyzer-snapshots key" << std::endl;
            continue;
        }
        auto snapshots = root["analyzer-snapshots"];
        for (auto test_node : snapshots.children()) {
            file.tests.emplace_back();
            auto& test = file.tests.back();
            if (test_node.has_child("name")) {
                c4::csubstr v = test_node["name"].val();
                test.name = v.str ? std::string(v.str, v.len) : std::string();
            }
            if (test_node.has_child("script")) {
                auto script_node = test_node["script"];
                test.script.ReadFrom(script_node);
                test.script.tree = &file.tree;
                test.script.node_id = script_node.id();
            }
            if (test_node.has_child("catalog") && test_node["catalog"].has_child("script")) {
                auto script_node = test_node["catalog"]["script"];
                test.catalog_entries.emplace_back();
                auto& entry = test.catalog_entries.back();
                entry.ReadFrom(script_node);
                entry.tree = &file.tree;
                entry.node_id = script_node.id();
            }
        }

        std::cout << "[ SETUP    ] " << filename << ": " << file.tests.size() << " tests" << std::endl;
        auto it = TEST_FILES.insert({filename, std::move(file)}).first;
        for (auto& t : it->second.tests) {
            t.script.tree = &it->second.tree;
            for (auto& e : t.catalog_entries) e.tree = &it->second.tree;
        }
    }
}

// Get the tests
std::vector<const AnalyzerSnapshotTest*> AnalyzerSnapshotTest::GetTests(std::string_view filename) {
    std::string name{filename};
    auto iter = TEST_FILES.find(name);
    if (iter == TEST_FILES.end()) {
        return {};
    }
    std::vector<const AnalyzerSnapshotTest*> tests;
    for (auto& test : iter->second.tests) {
        tests.emplace_back(&test);
    }
    return tests;
}

}  // namespace testing
}  // namespace dashql
