#include "dashql/testing/parser_snapshot_test.h"

#include <cstdint>
#include <fstream>
#include <iostream>

#include "dashql/buffers/index_generated.h"
#include "dashql/parser/grammar/enums.h"
#include "dashql/testing/xml_tests.h"
#include "pugixml.hpp"

namespace dashql::testing {

void operator<<(std::ostream& out, const ParserSnapshotTest& p) { out << p.name; }

void ParserSnapshotTest::EncodeAST(pugi::xml_node parent, std::string_view text,
                                   std::span<const buffers::parser::Node> ast, size_t root_node_id) {
    std::vector<std::tuple<pugi::xml_node, const buffers::parser::Node*>> pending;
    pending.push_back({parent.append_child("node"), &ast[root_node_id]});

    while (!pending.empty()) {
        auto [n, target] = pending.back();
        pending.pop_back();

        // Add or append to parent
        if (target->attribute_key() != buffers::parser::AttributeKey::NONE) {
            auto name = buffers::parser::EnumNameAttributeKey(target->attribute_key());
            n.append_attribute("key").set_value(name);
        }

        // Check node type
        n.append_attribute("type").set_value(
            buffers::parser::NodeTypeTypeTable()->names[static_cast<uint16_t>(target->node_type())]);
        switch (target->node_type()) {
            case buffers::parser::NodeType::NONE:
                break;
            case buffers::parser::NodeType::BOOL: {
                n.append_attribute("value") = target->children_begin_or_value() != 0;
                break;
            }
            case buffers::parser::NodeType::OPERATOR:
            case buffers::parser::NodeType::NAME:
            case buffers::parser::NodeType::LITERAL_NULL:
            case buffers::parser::NodeType::LITERAL_FLOAT:
            case buffers::parser::NodeType::LITERAL_INTEGER:
            case buffers::parser::NodeType::LITERAL_INTERVAL:
            case buffers::parser::NodeType::LITERAL_STRING: {
                EncodeLocation(n, target->location(), text);
                break;
            }
            case buffers::parser::NodeType::ARRAY: {
                EncodeLocation(n, target->location(), text);
                auto begin = target->children_begin_or_value();
                for (auto i = 0; i < target->children_count(); ++i) {
                    pending.push_back({n.append_child("node"), &ast[begin + i]});
                }
                break;
            }
            default: {
                auto node_type_id = static_cast<uint32_t>(target->node_type());
                if (node_type_id > static_cast<uint32_t>(buffers::parser::NodeType::OBJECT_KEYS_)) {
                    EncodeLocation(n, target->location(), text);
                    auto begin = target->children_begin_or_value();
                    for (auto i = 0; i < target->children_count(); ++i) {
                        pending.push_back({n.append_child("node"), &ast[begin + i]});
                    }
                } else if (node_type_id > static_cast<uint32_t>(buffers::parser::NodeType::ENUM_KEYS_)) {
                    n.append_attribute("value") = dashql::parser::getEnumText(*target);
                } else {
                    n.append_attribute("value") = target->children_begin_or_value();
                }
                break;
            }
        }
    }
}

/// Encode yaml
void ParserSnapshotTest::EncodeScript(pugi::xml_node root, const ScannedScript& scanned, const ParsedScript& parsed,
                                      std::string_view text) {
    // Unpack modules
    auto& nodes = parsed.nodes;
    auto& statements = parsed.statements;
    auto* stmt_type_tt = buffers::parser::StatementTypeTypeTable();
    auto* node_type_tt = buffers::parser::NodeTypeTypeTable();

    // Add the statements list
    auto stmts = root.append_child("statements");

    // Translate the statement tree with a DFS
    for (unsigned stmt_id = 0; stmt_id < statements.size(); ++stmt_id) {
        auto& s = statements[stmt_id];

        auto stmt = stmts.append_child("statement");
        stmt.append_attribute("type") = stmt_type_tt->names[static_cast<uint16_t>(s.type)];
        stmt.append_attribute("begin") = s.nodes_begin;
        stmt.append_attribute("count") = s.node_count;

        ParserSnapshotTest::EncodeAST(stmt, text, nodes, s.root);
    }

    // Add scanner errors
    auto parser_errors = root.append_child("scanner-errors");
    for (auto& [err_loc, err_msg] : scanned.errors) {
        auto error = parser_errors.append_child("error");
        error.append_attribute("message") = err_msg.c_str();
        EncodeLocation(error, err_loc, text);
    }

    // Add parser errors
    auto scanner_errors = root.append_child("parser-errors");
    for (auto& [err_loc, err_msg] : parsed.errors) {
        auto error = scanner_errors.append_child("error");
        error.append_attribute("message") = err_msg.c_str();
        EncodeLocation(error, err_loc, text);
    }

    // Add line breaks
    auto line_breaks = root.append_child("line-breaks");
    for (auto& lb : scanned.line_breaks) {
        auto lb_node = line_breaks.append_child("line-break");
        EncodeLocation(lb_node, lb, text);
    }

    // Add comments
    auto comments = root.append_child("comments");
    for (auto& comment : scanned.comments) {
        auto comment_node = comments.append_child("comment");
        EncodeLocation(comment_node, comment, text);
    }
}

// The files
static std::unordered_map<std::string, std::vector<ParserSnapshotTest>> TEST_FILES;

// Load the tests
void ParserSnapshotTest::LoadTests(const std::filesystem::path& snapshots_dir) {
    std::cout << "Loading grammar tests at: " << snapshots_dir << std::endl;

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
        auto root = doc.child("parser-snapshots");

        // Read tests
        std::vector<ParserSnapshotTest> tests;
        for (auto test : root.children()) {
            // Create test
            tests.emplace_back();
            auto& t = tests.back();
            t.name = test.attribute("name").as_string();
            t.debug = test.attribute("debug").as_bool();
            t.input = test.child("input").last_child().value();

            pugi::xml_document expected;
            for (auto s : test.child("expected").children()) {
                expected.append_copy(s);
            }
            t.expected = std::move(expected);
        }

        std::cout << "[ SETUP    ] " << filename << ": " << tests.size() << " tests" << std::endl;

        // Register test
        TEST_FILES.insert({filename, std::move(tests)});
    }
}

// Get the tests
std::vector<const ParserSnapshotTest*> ParserSnapshotTest::GetTests(std::string_view filename) {
    std::string name{filename};
    auto iter = TEST_FILES.find(name);
    if (iter == TEST_FILES.end()) {
        return {};
    }
    std::vector<const ParserSnapshotTest*> tests;
    for (auto& test : iter->second) {
        tests.emplace_back(&test);
    }
    return tests;
}

}  // namespace dashql::testing
