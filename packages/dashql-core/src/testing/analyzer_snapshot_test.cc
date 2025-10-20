#include "dashql/testing/analyzer_snapshot_test.h"

#include <format>
#include <fstream>

#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"
#include "dashql/script_snippet.h"
#include "dashql/testing/parser_snapshot_test.h"
#include "dashql/testing/xml_tests.h"
#include "gtest/gtest.h"

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

/// Write all table declarations
static void writeTables(pugi::xml_node root, const AnalyzedScript& target) {
    target.GetTables().ForEach([&](size_t ti, const CatalogEntry::TableDeclaration& table_decl) {
        auto [db_id, schema_id] = table_decl.catalog_schema_id.UnpackSchemaID();
        auto table_id = table_decl.object_id.UnpackTableID();

        auto xml_tbl = root.append_child("table");
        std::string table_name{table_decl.table_name.table_name.get().text};
        std::string table_catalog_id = std::format("{}.{}.{}", db_id, schema_id, table_id.Pack());
        xml_tbl.append_attribute("id").set_value(table_catalog_id.c_str());
        xml_tbl.append_attribute("name").set_value(table_name.c_str());
        assert(table_decl.ast_node_id.has_value());
        WriteLocation(xml_tbl, target.parsed_script->nodes[*table_decl.ast_node_id].location(),
                      target.parsed_script->scanned_script->GetInput());
        // Write child columns
        for (size_t i = 0; i < table_decl.table_columns.size(); ++i) {
            auto& column_decl = table_decl.table_columns[i];
            auto xml_col = xml_tbl.append_child("column");
            std::string column_catalog_id = std::format("{}.{}", table_catalog_id, i);
            xml_col.append_attribute("id").set_value(column_catalog_id.c_str());
            if (!column_decl.column_name.get().text.empty()) {
                std::string column_name{column_decl.column_name.get().text};
                xml_col.append_attribute("name").set_value(column_name.c_str());
            } else {
                xml_col.append_attribute("name").set_value("?");
            }
            if (auto node_id = column_decl.ast_node_id; node_id.has_value()) {
                WriteLocation(xml_col, target.parsed_script->nodes[*node_id].location(),
                              target.parsed_script->scanned_script->GetInput());
            }
        }
    });
}

namespace testing {

void AnalyzerSnapshotTest::ScriptAnalysisSnapshot::ReadFrom(const pugi::xml_node& script_node) {
    input = script_node.child("input").last_child().value();
    errors.append_copy(script_node.child("errors"));
    tables.append_copy(script_node.child("tables"));
    table_references.append_copy(script_node.child("table-refs"));
    expressions.append_copy(script_node.child("expressions"));
    constant_expressions.append_copy(script_node.child("constants"));
    column_transforms.append_copy(script_node.child("column-transforms"));
    column_resrictions.append_copy(script_node.child("column-restrictions"));
}

void AnalyzerSnapshotTest::TestCatalogSnapshot(const std::vector<ScriptAnalysisSnapshot>& snaps, pugi::xml_node& node,
                                               Catalog& catalog, std::vector<std::unique_ptr<Script>>& catalog_scripts,
                                               size_t& entry_ids) {
    for (size_t i = 0; i < snaps.size(); ++i) {
        auto& entry = snaps[i];
        auto entry_id = entry_ids++;

        // Create a new script
        catalog_scripts.push_back(std::make_unique<Script>(catalog, entry_id));
        auto& script = *catalog_scripts.back();

        // Make sure the analysis snapshot looks as expected
        auto script_node = node.append_child("script");
        TestScriptSnapshot(entry, script_node, script, entry_id, false);

        // Add script to catalog.
        // Note that the catalog rank here is just picked to equal the entry id for simplicity.
        // We could be more flexible here in tests.
        catalog.LoadScript(script, entry_id);
    }
}

void AnalyzerSnapshotTest::TestScriptSnapshot(const ScriptAnalysisSnapshot& snap, pugi::xml_node& node, Script& script,
                                              size_t entry_id, bool is_main) {
    script.InsertTextAt(entry_id, snap.input);

    ASSERT_EQ(script.Scan(), buffers::status::StatusCode::OK);
    ASSERT_EQ(script.Parse(), buffers::status::StatusCode::OK);
    ASSERT_EQ(script.Analyze(), buffers::status::StatusCode::OK);

    AnalyzerSnapshotTest::EncodeScript(node, *script.analyzed_script, is_main);

    ASSERT_TRUE(Matches(node.child("errors"), snap.errors));
    ASSERT_TRUE(Matches(node.child("tables"), snap.tables));
    ASSERT_TRUE(Matches(node.child("table-refs"), snap.table_references));
    ASSERT_TRUE(Matches(node.child("expressions"), snap.expressions));
    ASSERT_TRUE(Matches(node.child("constants"), snap.constant_expressions));
    ASSERT_TRUE(Matches(node.child("column-transforms"), snap.column_transforms));
    ASSERT_TRUE(Matches(node.child("column-restrictions"), snap.column_resrictions));
}

void operator<<(std::ostream& out, const AnalyzerSnapshotTest& p) { out << p.name; }

void AnalyzerSnapshotTest::EncodeSnippet(pugi::xml_node parent, const AnalyzedScript& analyzed, size_t root_node_id) {
    auto& parsed = *analyzed.parsed_script;
    auto& scanned = *parsed.scanned_script;
    auto& script_text = scanned.text_buffer;
    auto& script_ast = parsed.GetNodes();
    auto& script_markers = analyzed.node_markers;

    auto snippet = ScriptSnippet::Extract(script_text, script_ast, script_markers, root_node_id, scanned.name_registry);
    auto sig_masked = snippet.ComputeSignature(true);
    auto sig_unmasked = snippet.ComputeSignature(false);

    auto out_snippet = parent.append_child("snippet");
    out_snippet.append_attribute("template").set_value(sig_masked);
    out_snippet.append_attribute("raw").set_value(std::to_string(sig_unmasked).c_str());
    out_snippet.append_child("text").text().set(std::string{snippet.text}.c_str());
    auto out_nodes = out_snippet.append_child("nodes");
    out_nodes.append_attribute("count").set_value(snippet.nodes.size());
    out_nodes.append_attribute("bytes").set_value(snippet.nodes.size() * sizeof(buffers::parser::Node));
    ParserSnapshotTest::EncodeAST(out_nodes, snippet.text, snippet.nodes, snippet.root_node_id);
}

void AnalyzerSnapshotTest::EncodeScript(pugi::xml_node out, const AnalyzedScript& script, bool is_main) {
    // Unpack modules
    auto* stmt_type_tt = buffers::parser::StatementTypeTypeTable();
    auto* node_type_tt = buffers::parser::NodeTypeTypeTable();

    out.prepend_attribute("id").set_value(script.GetCatalogEntryId());

    // Write local declarations
    if (script.GetTables().GetSize() > 0) {
        auto tables_node = out.append_child("tables");
        writeTables(tables_node, script);
    }
    // Encode errors
    auto errors_node = out.append_child("errors");
    for (auto& error : script.errors) {
        auto error_node = errors_node.append_child("error");
        error_node.append_attribute("type").set_value(buffers::analyzer::EnumNameAnalyzerErrorType(error.error_type));
        error_node.append_attribute("message").set_value(error.message.c_str());
        WriteLocation(error_node, *error.location, script.parsed_script->scanned_script->GetInput());
    }
    // Write table references
    if (!script.table_references.IsEmpty()) {
        auto table_refs_node = out.append_child("table-refs");
        script.table_references.ForEach([&](size_t i, const AnalyzedScript::TableReference& ref) {
            auto xml_ref = table_refs_node.append_child("table-ref");
            std::visit(
                [&](const auto& value) {
                    using T = std::decay_t<decltype(value)>;

                    if constexpr (std::is_same_v<T, std::monostate>) {
                        // Empty variant case - no action needed
                    } else if constexpr (std::is_same_v<T, AnalyzedScript::TableReference::RelationExpression>) {
                        auto& relation_expr = value;
                        if (!relation_expr.resolved_table.has_value()) {
                            xml_ref.append_attribute("type").set_value("name/unresolved");
                        } else {
                            auto& resolved = relation_expr.resolved_table.value();
                            auto [db_id, schema_id] = resolved.catalog_schema_id.UnpackSchemaID();
                            auto table_id = resolved.catalog_table_id.UnpackTableID();
                            std::string catalog_id = std::format("{}.{}.{}", db_id, schema_id, table_id.Pack());
                            auto type = is_main && table_id.GetOrigin() == script.GetCatalogEntryId() ? "name/internal"
                                                                                                      : "name/catalog";
                            xml_ref.append_attribute("type").set_value(type);
                            xml_ref.append_attribute("id").set_value(catalog_id.c_str());
                        }
                    } else {
                        static_assert(always_false<T>, "Unhandled table reference type in analyzer snapshot test");
                    }
                },
                ref.inner);
            if (ref.ast_statement_id.has_value()) {
                xml_ref.append_attribute("stmt").set_value(*ref.ast_statement_id);
            }
            WriteLocation(xml_ref, script.parsed_script->nodes[ref.ast_node_id].location(),
                          script.parsed_script->scanned_script->GetInput());
        });
    }

    // Write expressions
    if (!script.expressions.IsEmpty()) {
        auto expr_node = out.append_child("expressions");
        script.expressions.ForEach([&](size_t i, const AnalyzedScript::Expression& ref) {
            auto xml_ref = expr_node.append_child("expr");
            xml_ref.append_attribute("id").set_value(i);
            std::visit(
                [&](const auto& value) {
                    using T = std::decay_t<decltype(value)>;

                    if constexpr (std::is_same_v<T, std::monostate>) {
                        // Empty variant case - no action needed
                    } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::ColumnRef>) {
                        auto& column_ref = value;
                        if (!column_ref.resolved_column.has_value()) {
                            xml_ref.append_attribute("type").set_value("colref/unresolved");
                        } else {
                            auto& resolved = column_ref.resolved_column.value();
                            auto [db_id, schema_id] = resolved.catalog_schema_id.UnpackSchemaID();
                            auto [table_id, column_idx] = resolved.catalog_table_column_id.UnpackTableColumnID();
                            std::string catalog_id =
                                std::format("{}.{}.{}.{}", db_id, schema_id, table_id.Pack(), column_idx);
                            auto type = (is_main && table_id.GetOrigin() == script.GetCatalogEntryId())
                                            ? "colref/internal"
                                            : "colref/catalog";
                            xml_ref.append_attribute("type").set_value(type);
                            xml_ref.append_attribute("catalog").set_value(catalog_id.c_str());
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
                        xml_ref.append_attribute("type").set_value(type_name.c_str());
                    } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::Comparison>) {
                        auto& cmp = value;
                        xml_ref.append_attribute("type").set_value("comparison");

                        auto* op_tt = buffers::algebra::ComparisonFunctionTypeTable();
                        xml_ref.append_attribute("op").set_value(op_tt->names[static_cast<uint8_t>(cmp.func)]);
                        xml_ref.append_attribute("left").set_value(cmp.left_expression_id);
                        xml_ref.append_attribute("right").set_value(cmp.right_expression_id);
                    } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::BinaryExpression>) {
                        auto& binary = value;
                        xml_ref.append_attribute("type").set_value("binary");

                        auto* op_tt = buffers::algebra::BinaryExpressionFunctionTypeTable();
                        xml_ref.append_attribute("op").set_value(op_tt->names[static_cast<uint8_t>(binary.func)]);
                        xml_ref.append_attribute("left").set_value(binary.left_expression_id);
                        xml_ref.append_attribute("right").set_value(binary.right_expression_id);
                    } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::FunctionCallExpression>) {
                        auto& func = value;
                        xml_ref.append_attribute("type").set_value("func");
                        std::visit(
                            [&](const auto& func_name_value) {
                                using FuncT = std::decay_t<decltype(func_name_value)>;
                                if constexpr (std::is_same_v<FuncT, buffers::parser::KnownFunction>) {
                                    auto known = func_name_value;
                                    auto known_name =
                                        buffers::parser::KnownFunctionTypeTable()->names[static_cast<size_t>(known)];
                                    xml_ref.append_attribute("known").set_value(known_name);
                                } else if constexpr (std::is_same_v<FuncT, CatalogEntry::QualifiedFunctionName>) {
                                    auto func_name = func_name_value.getDebugString();
                                    xml_ref.append_attribute("name").set_value(func_name.c_str());
                                } else {
                                    static_assert(always_false<FuncT>,
                                                  "Unhandled function name type in analyzer snapshot test");
                                }
                            },
                            func.function_name);
                    } else if constexpr (std::is_same_v<T, AnalyzedScript::Expression::ConstIntervalCast>) {
                        auto& func = value;
                        xml_ref.append_attribute("type").set_value("constcast/interval");
                    } else {
                        static_assert(always_false<T>, "Unhandled expression type in analyzer snapshot test");
                    }
                },
                ref.inner);
            if (ref.is_constant_expression) {
                xml_ref.append_attribute("const").set_value(ref.is_constant_expression);
            }
            if (ref.is_column_restriction && ref.target_expression_id.has_value()) {
                xml_ref.append_attribute("restrict").set_value(ref.target_expression_id.value());
            }
            if (ref.is_column_transform && ref.target_expression_id.has_value()) {
                xml_ref.append_attribute("transform").set_value(ref.target_expression_id.value());
            }
            if (ref.ast_statement_id.has_value()) {
                xml_ref.append_attribute("stmt").set_value(*ref.ast_statement_id);
            }
            WriteLocation(xml_ref, script.parsed_script->nodes[ref.ast_node_id].location(),
                          script.parsed_script->scanned_script->GetInput());
        });
    }

    // Write constant expressions
    if (!script.constant_expressions.IsEmpty()) {
        auto list_node = out.append_child("constants");
        script.constant_expressions.ForEach([&](size_t _i, const AnalyzedScript::ConstantExpression& constant) {
            auto xml_ref = list_node.append_child("constant");
            xml_ref.append_attribute("expr").set_value(constant.root.get().expression_id);
            WriteLocation(xml_ref, script.parsed_script->nodes[constant.root.get().ast_node_id].location(),
                          script.parsed_script->scanned_script->GetInput());
            if (!constant.root.get().IsLiteral()) {
                EncodeSnippet(xml_ref, script, constant.root.get().ast_node_id);
            }
        });
    }
    // Write transforms
    if (!script.column_transforms.IsEmpty()) {
        auto list_node = out.append_child("column-transforms");
        script.column_transforms.ForEach([&](size_t _i, const AnalyzedScript::ColumnTransform& transform) {
            auto xml_ref = list_node.append_child("transform");
            xml_ref.append_attribute("expr").set_value(transform.root.get().expression_id);
            EncodeSnippet(xml_ref, script, transform.root.get().ast_node_id);
        });
    }
    // Write restrictions
    if (!script.column_restrictions.IsEmpty()) {
        auto list_node = out.append_child("column-restrictions");
        script.column_restrictions.ForEach([&](size_t _i, const AnalyzedScript::ColumnRestriction& restriction) {
            auto xml_ref = list_node.append_child("restriction");
            xml_ref.append_attribute("expr").set_value(restriction.root.get().expression_id);
            EncodeSnippet(xml_ref, script, restriction.root.get().ast_node_id);
        });
    }
}

// The files
static std::unordered_map<std::string, std::vector<AnalyzerSnapshotTest>> TEST_FILES;

/// Get the grammar tests
void AnalyzerSnapshotTest::LoadTests(const std::filesystem::path& snapshots_dir) {
    std::cout << "Loading analyzer tests at: " << snapshots_dir << std::endl;

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
        auto root = doc.child("analyzer-snapshots");

        // Read tests
        std::vector<AnalyzerSnapshotTest> tests;
        for (auto test_node : root.children()) {
            tests.emplace_back();
            auto& test = tests.back();
            test.name = test_node.attribute("name").as_string();

            // Read catalog
            auto catalog_node = test_node.child("catalog");

            // Read main script
            auto main_node = test_node.child("script");
            test.script.ReadFrom(main_node);

            // Read catalog entries
            for (auto entry_node : catalog_node.children()) {
                test.catalog_entries.emplace_back();
                auto& entry = test.catalog_entries.back();
                std::string entry_name = entry_node.name();
                if (entry_name == "script") {
                    entry.ReadFrom(entry_node);
                } else {
                    std::cout << "[    ERROR ] unknown test element " << entry_name << std::endl;
                }
            }
        }

        std::cout << "[ SETUP    ] " << filename << ": " << tests.size() << " tests" << std::endl;

        // Register test
        TEST_FILES.insert({filename, std::move(tests)});
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
    for (auto& test : iter->second) {
        tests.emplace_back(&test);
    }
    return tests;
}

}  // namespace testing
}  // namespace dashql
