#include "dashql/test/grammar_tests.h"

#include <fstream>
#include <cstdint>
#include <iostream>
#include <regex>
#include <sstream>
#include <stack>
#include <unordered_set>

#include "dashql/proto_generated.h"
#include "pugixml.hpp"

namespace dashql {
namespace test {

namespace sx = proto::syntax;
namespace sxs = proto::syntax_sql;
namespace sxd = proto::syntax_dashql;

namespace {

constexpr size_t INLINE_LOCATION_CAP = 20;
constexpr size_t LOCATION_HINT_LENGTH = 10;

void encode(pugi::xml_node& n, proto::syntax::Location loc, std::string_view text) {
    auto begin = loc.offset();
    auto end = loc.offset() + loc.length();
    {
        std::stringstream ss;
        ss << begin << ".." << end;
        n.append_attribute("loc") = ss.str().c_str();
    }
    {
        std::stringstream ss;
        if (loc.length() < INLINE_LOCATION_CAP) {
            ss << text.substr(loc.offset(), loc.length());
        } else {
            auto prefix = text.substr(loc.offset(), LOCATION_HINT_LENGTH);
            auto suffix = text.substr(loc.offset() + loc.length() - LOCATION_HINT_LENGTH, LOCATION_HINT_LENGTH);
            ss << prefix << ".." << suffix;
        }
        n.append_attribute("text") = ss.str().c_str();
    }
}

void encode(pugi::xml_node& n, const proto::syntax::ErrorT& err, std::string_view text) {
    n.append_attribute("message") = err.message.c_str();
    encode(n, *err.location, text);
}

const char* getEnumText(const sx::Node& target) {
    auto nt = target.node_type();
    auto v = static_cast<uint32_t>(target.children_begin_or_value());
    switch (nt) {
        case sx::NodeType::ENUM_DASHQL_VIZ_TYPE:
            return sxd::VizTypeTypeTable()->names[v];
        case sx::NodeType::ENUM_DASHQL_PARAMETER_TYPE:
            return sxd::ParameterTypeTypeTable()->names[v];
        case sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE:
            return sxd::LoadMethodTypeTypeTable()->names[v];
        case sx::NodeType::ENUM_DASHQL_EXTRACT_METHOD_TYPE:
            return sxd::ExtractMethodTypeTypeTable()->names[v];

        case sx::NodeType::ENUM_SQL_TEMP_TYPE:
            return sxs::TempTypeTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_CONST_TYPE:
            return sxs::AConstTypeTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_EXPRESSION_FUNCTION:
            return sxs::ExpressionFunctionTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_ORDER_DIRECTION:
            return sxs::OrderDirectionTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_ORDER_NULL_RULE:
            return sxs::OrderNullRuleTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_COMBINE_MODIFIER:
            return sxs::CombineModifierTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_COMBINE_OPERATION:
            return sxs::CombineOperationTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_NUMERIC_TYPE_TAG:
            return sxs::NumericTypeTagTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_WINDOW_BOUND_MODE:
            return sxs::WindowBoundModeTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_WINDOW_RANGE_MODE:
            return sxs::WindowRangeModeTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE:
            return sxs::WindowExclusionModeTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION:
            return sxs::WindowBoundDirectionTypeTable()->names[v];

        default:
            return "?";
    }
}

}  // namespace

/// Encode yaml
void GrammarTest::EncodeProgram(pugi::xml_node& root, const proto::syntax::ProgramT& program, std::string_view text) {
    // Unpack modules
    auto& nodes = program.nodes;
    auto& statements = program.statements;
    auto* stmt_type_tt = proto::syntax::StatementTypeTypeTable();
    auto* node_type_tt = proto::syntax::NodeTypeTypeTable();
    auto* attr_key_tt = proto::syntax::AttributeKeyTypeTable();

    // Add the statements list
    auto stmts = root.append_child("statements");

    // Translate the statement tree with a DFS
    for (unsigned stmt_id = 0; stmt_id < statements.size(); ++stmt_id) {
        auto& s = *statements[stmt_id];

        auto stmt = stmts.append_child("statement");
        stmt.append_attribute("type") = stmt_type_tt->names[static_cast<uint16_t>(s.statement_type)];
        if (!s.name_qualified.empty()) stmt.append_attribute("name") = s.name_qualified.c_str();

        std::vector<std::tuple<pugi::xml_node, const sx::Node*>> pending;
        pending.push_back({stmt.append_child("node"), &nodes[s.root_node]});

        while (!pending.empty()) {
            auto [n, target] = pending.back();
            pending.pop_back();

            // Add or append to parent
            if (target->attribute_key() != sx::AttributeKey::NONE) {
                n.append_attribute("key") = attr_key_tt->names[static_cast<size_t>(target->attribute_key())];
            }

            // Check node type
            switch (target->node_type()) {
                case sx::NodeType::NONE:
                    break;
                case sx::NodeType::BOOL: {
                    n.append_attribute("value") = target->children_begin_or_value() != 0;
                    break;
                }
                case sx::NodeType::UI32: {
                    n.append_attribute("value") = target->children_begin_or_value();
                    break;
                }
                case sx::NodeType::STRING_REF: {
                    encode(n, target->location(), text);
                    break;
                }
                case sx::NodeType::ARRAY: {
                    auto begin = target->children_begin_or_value();
                    for (auto i = 0; i < target->children_count(); ++i) {
                        pending.push_back({n.append_child("node"), &nodes[begin + i]});
                    }
                    break;
                }
                default: {
                    auto node_type_id = static_cast<uint32_t>(target->node_type());
                    if (node_type_id > static_cast<uint32_t>(sx::NodeType::OBJECT_MIN_)) {
                        n.append_attribute("type") = node_type_tt->names[static_cast<size_t>(target->node_type())];
                        encode(n, target->location(), text);
                        auto begin = target->children_begin_or_value();
                        for (auto i = 0; i < target->children_count(); ++i) {
                            pending.push_back({n.append_child("node"), &nodes[begin + i]});
                        }
                    } else if (node_type_id > static_cast<uint32_t>(sx::NodeType::ENUM_MIN_)) {
                        n.append_attribute("value") = getEnumText(*target);
                    } else {
                        n.append_attribute("value") = target->children_begin_or_value();
                    }
                    break;
                }
            }
        }
    }

    // Add errors
    auto errors = root.append_child("errors");
    for (auto& err : program.errors) {
        auto error = errors.append_child("error");
        encode(error, *err, text);
    }

    // Add line breaks
    auto line_breaks = root.append_child("line_breaks");
    for (auto& lb : program.line_breaks) {
        auto lb_node = line_breaks.append_child("line_break");
        encode(lb_node, lb, text);
    }

    // Add comments
    auto comments = root.append_child("comments");
    for (auto& comment : program.comments) {
        auto comment_node = comments.append_child("comment");
        encode(comment_node, comment, text);
    }

    // Add comments
    auto dependencies = root.append_child("dependencies");
    for (auto& dep : program.dependencies) {
        auto loc = program.nodes[dep.target_node()].location();
        auto n = dependencies.append_child("dependency");
        n.append_attribute("type") = sx::DependencyTypeTypeTable()->names[static_cast<size_t>(dep.type())];
        n.append_attribute("source") = dep.source_statement();
        n.append_attribute("target") = dep.target_statement();
        encode(n, loc, text);
    };
}

/// Matches the expected result?
::testing::AssertionResult GrammarTest::Matches(const pugi::xml_node& actual) const {
    std::stringstream expected_ss;
    std::stringstream actual_ss;
    expected.print(expected_ss);
    actual.print(actual_ss);
    auto expected_str = expected_ss.str();
    auto actual_str = actual_ss.str();
    if (expected_str == actual_str) return ::testing::AssertionSuccess();

    std::stringstream err;

    err << std::endl;
    err << "OUTPUT" << std::endl;
    err << "----------------------------------------" << std::endl;
    err << actual_str << std::endl;

    err << "EXPECTED" << std::endl;
    err << "----------------------------------------" << std::endl;
    std::vector<std::string> expected_lines, actual_lines;
    ::testing::internal::SplitString(expected_str, '\n', &expected_lines);
    ::testing::internal::SplitString(actual_str, '\n', &actual_lines);
    err << ::testing::internal::edit_distance::CreateUnifiedDiff(actual_lines, expected_lines);
    err << std::endl;

    return ::testing::AssertionFailure() << err.str();
}

// The files
static std::unordered_map<std::string, std::vector<GrammarTest>> TEST_FILES;

// Load the tests
void GrammarTest::LoadTests(std::filesystem::path& source_dir) {
    auto grammar_dir = source_dir / "test" / "grammar";

    std::cout << "Loading grammar tests at: " << grammar_dir << std::endl;
    
    for (auto& p : std::filesystem::directory_iterator(grammar_dir)) {
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

        // Read tests
        std::vector<GrammarTest> tests;
        for (auto test : doc.children()) {
            // Create test
            tests.emplace_back();
            auto& t = tests.back();
            t.name = test.attribute("name").as_string();
            t.input = test.child("input").last_child().value();

            pugi::xml_document expected;
            for (auto s: test.child("expected").children()) {
                expected.append_copy(s);
            }
            t.expected = std::move(expected);
        }

        std::cout << "[ SETUP    ] " << filename << ": " << tests.size() << " tests" << std::endl;

        // Register test
        TEST_FILES.insert({filename, move(tests)});
    }
}

// Get the tests
std::vector<const GrammarTest*> GrammarTest::GetTests(std::string_view filename) {
    std::string name{filename};
    auto iter = TEST_FILES.find(name);
    if (iter == TEST_FILES.end()) {
        return {};
    }
    std::vector<const GrammarTest*> tests;
    for (auto& test: iter->second) {
        tests.emplace_back(&test);
    }
    std::cout << "filename " << tests.size() << std::endl;
    return tests;
}

}  // namespace test
}  // namespace dashql
