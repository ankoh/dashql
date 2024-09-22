#include "sqlynx/testing/analyzer_snapshot_test.h"

#include <fstream>

#include "gtest/gtest.h"
#include "sqlynx/analyzer/analyzer.h"
#include "sqlynx/proto/proto_generated.h"
#include "sqlynx/script.h"
#include "sqlynx/testing/xml_tests.h"

namespace sqlynx {

using namespace testing;

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
    for (auto& table_decl : target.GetTables()) {
        auto xml_tbl = root.append_child("table");
        std::string table_name{table_decl.table_name.table_name};
        xml_tbl.append_attribute("name").set_value(table_name.c_str());
        assert(table_decl.ast_node_id.has_value());
        WriteLocation(xml_tbl, target.parsed_script->nodes[*table_decl.ast_node_id].location(),
                      target.parsed_script->scanned_script->GetInput());
        // Write child columns
        for (auto& column_decl : table_decl.table_columns) {
            auto xml_col = xml_tbl.append_child("column");
            if (!column_decl.column_name.empty()) {
                std::string column_name{column_decl.column_name};
                xml_col.append_attribute("name").set_value(column_name.c_str());
            } else {
                xml_col.append_attribute("name").set_value("?");
            }
            if (auto node_id = column_decl.ast_node_id; node_id.has_value()) {
                WriteLocation(xml_col, target.parsed_script->nodes[*node_id].location(),
                              target.parsed_script->scanned_script->GetInput());
            }
        }
    }
}

namespace testing {

void AnalyzerSnapshotTest::TestRegistrySnapshot(const std::vector<ScriptAnalysisSnapshot>& snaps, pugi::xml_node& node,
                                                Catalog& catalog, std::vector<std::unique_ptr<Script>>& catalog_scripts,
                                                size_t& entry_ids) {
    for (size_t i = 0; i < snaps.size(); ++i) {
        auto& entry = snaps[i];
        auto entry_id = entry_ids++;
        catalog_scripts.push_back(std::make_unique<Script>(catalog, entry_id));

        auto& script = *catalog_scripts.back();
        script.InsertTextAt(0, entry.input);
        auto scanned = script.Scan();
        ASSERT_EQ(scanned.second, proto::StatusCode::OK);
        auto parsed = script.Parse();
        ASSERT_EQ(parsed.second, proto::StatusCode::OK);
        auto analyzed = script.Analyze();
        ASSERT_EQ(analyzed.second, proto::StatusCode::OK);

        catalog.LoadScript(script, entry_id);

        auto script_node = node.append_child("script");
        AnalyzerSnapshotTest::EncodeScript(script_node, *script.analyzed_script, false);

        ASSERT_TRUE(Matches(script_node.child("tables"), entry.tables));
        ASSERT_TRUE(Matches(script_node.child("table-references"), entry.table_references));
        ASSERT_TRUE(Matches(script_node.child("column-references"), entry.column_references));
        ASSERT_TRUE(Matches(script_node.child("query-graph"), entry.graph_edges));
    }
}

void AnalyzerSnapshotTest::TestMainScriptSnapshot(const ScriptAnalysisSnapshot& snap, pugi::xml_node& node,
                                                  Script& script, size_t entry_id) {
    script.InsertTextAt(entry_id, snap.input);

    auto scan = script.Scan();
    ASSERT_EQ(scan.second, proto::StatusCode::OK);
    auto parsed = script.Parse();
    ASSERT_EQ(parsed.second, proto::StatusCode::OK);
    auto analyzed = script.Analyze();
    ASSERT_EQ(analyzed.second, proto::StatusCode::OK) << proto::EnumNameStatusCode(analyzed.second);

    AnalyzerSnapshotTest::EncodeScript(node, *script.analyzed_script, true);

    ASSERT_TRUE(Matches(node.child("tables"), snap.tables));
    ASSERT_TRUE(Matches(node.child("table-references"), snap.table_references));
    ASSERT_TRUE(Matches(node.child("column-references"), snap.column_references));
    ASSERT_TRUE(Matches(node.child("query-graph"), snap.graph_edges));
}

void operator<<(std::ostream& out, const AnalyzerSnapshotTest& p) { out << p.name; }

void AnalyzerSnapshotTest::EncodeScript(pugi::xml_node out, const AnalyzedScript& script, bool is_main) {
    // Unpack modules
    auto* stmt_type_tt = proto::StatementTypeTypeTable();
    auto* node_type_tt = proto::NodeTypeTypeTable();

    out.prepend_attribute("id").set_value(script.GetCatalogEntryId());

    // Write local declarations
    if (script.GetTables().GetSize() > 0) {
        auto tables_node = out.append_child("tables");
        writeTables(tables_node, script);
    }

    // Write table references
    if (!script.table_references.empty()) {
        auto table_refs_node = out.append_child("table-references");
        for (auto& ref : script.table_references) {
            auto tag = ref.resolved_catalog_table_id.IsNull() ? "unresolved"
                       : (is_main && ref.resolved_catalog_table_id.GetExternalId() == script.GetCatalogEntryId())
                           ? "internal"
                           : "external";
            auto xml_ref = table_refs_node.append_child(tag);
            if (!ref.resolved_catalog_table_id.IsNull()) {
                xml_ref.append_attribute("schema").set_value(ref.resolved_catalog_table_id.GetExternalId());
                xml_ref.append_attribute("table").set_value(ref.resolved_catalog_table_id.GetIndex());
            }
            if (ref.ast_statement_id.has_value()) {
                xml_ref.append_attribute("stmt").set_value(*ref.ast_statement_id);
            }
            assert(ref.ast_node_id.has_value());
            WriteLocation(xml_ref, script.parsed_script->nodes[*ref.ast_node_id].location(),
                          script.parsed_script->scanned_script->GetInput());
        }
    }

    // Write column references
    if (!script.column_references.empty()) {
        auto col_refs_node = out.append_child("column-references");
        for (auto& ref : script.column_references) {
            auto tag = ref.resolved_catalog_table_id.IsNull() ? "unresolved"
                       : (is_main && ref.resolved_catalog_table_id.GetExternalId() == script.GetCatalogEntryId())
                           ? "internal"
                           : "external";
            auto xml_ref = col_refs_node.append_child(tag);
            if (!ref.resolved_catalog_table_id.IsNull()) {
                xml_ref.append_attribute("schema").set_value(ref.resolved_catalog_table_id.GetExternalId());
                xml_ref.append_attribute("table").set_value(ref.resolved_catalog_table_id.GetIndex());
            }
            if (ref.resolved_table_column_id.has_value()) {
                xml_ref.append_attribute("column").set_value(*ref.resolved_table_column_id);
            }
            if (ref.ast_statement_id.has_value()) {
                xml_ref.append_attribute("stmt").set_value(*ref.ast_statement_id);
            }
            assert(ref.ast_node_id.has_value());
            WriteLocation(xml_ref, script.parsed_script->nodes[*ref.ast_node_id].location(),
                          script.parsed_script->scanned_script->GetInput());
        }
    }

    // Write join edges
    if (!script.graph_edges.empty()) {
        auto query_graph_node = out.append_child("query-graph");
        for (auto& edge : script.graph_edges) {
            auto xml_edge = query_graph_node.append_child("edge");
            xml_edge.append_attribute("op").set_value(proto::EnumNameExpressionOperator(edge.expression_operator));
            assert(edge.ast_node_id.has_value());
            WriteLocation(xml_edge, script.parsed_script->nodes[*edge.ast_node_id].location(),
                          script.parsed_script->scanned_script->GetInput());
            for (size_t i = 0; i < edge.node_count_left; ++i) {
                auto& node = script.graph_edge_nodes[edge.nodes_begin + i];
                auto xml_node = xml_edge.append_child("node");
                xml_node.append_attribute("side").set_value(0);
                xml_node.append_attribute("ref").set_value(node.column_reference_id);
            }
            for (size_t i = 0; i < edge.node_count_right; ++i) {
                auto& node = script.graph_edge_nodes[edge.nodes_begin + edge.node_count_left + i];
                assert(!ExternalObjectID(script.GetCatalogEntryId(), node.column_reference_id).IsNull());
                auto xml_node = xml_edge.append_child("node");
                xml_node.append_attribute("side").set_value(1);
                xml_node.append_attribute("ref").set_value(node.column_reference_id);
            }
        }
    }
}

// The files
static std::unordered_map<std::string, std::vector<AnalyzerSnapshotTest>> TEST_FILES;

/// Get the grammar tests
void AnalyzerSnapshotTest::LoadTests(std::filesystem::path& source_dir) {
    auto snapshots_dir = source_dir / "snapshots" / "analyzer";
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
            test.catalog_default_database = catalog_node.attribute("database").as_string();
            test.catalog_default_schema = catalog_node.attribute("schema").as_string();

            // Read main script
            {
                auto main_node = test_node.child("script");
                test.script.input = main_node.child("input").last_child().value();
                test.script.tables.append_copy(main_node.child("tables"));
                test.script.table_references.append_copy(main_node.child("table-references"));
                test.script.column_references.append_copy(main_node.child("column-references"));
                test.script.graph_edges.append_copy(main_node.child("query-graph"));
            }

            // Read catalog entries
            for (auto entry_node : catalog_node.children()) {
                test.catalog_entries.emplace_back();
                auto& entry = test.catalog_entries.back();
                std::string entry_name = entry_node.name();
                if (entry_name == "script") {
                    entry.input = entry_node.child("input").last_child().value();
                    entry.tables.append_copy(entry_node.child("tables"));
                    entry.table_references.append_copy(entry_node.child("table-references"));
                    entry.column_references.append_copy(entry_node.child("column-references"));
                    entry.graph_edges.append_copy(entry_node.child("query-graph"));
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
}  // namespace sqlynx
