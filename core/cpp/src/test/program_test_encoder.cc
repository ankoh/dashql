#include "dashql/test/program_test_encoder.h"

#include <cstdint>
#include <iostream>
#include <regex>
#include <sstream>
#include <stack>
#include <unordered_set>

#include "dashql/proto/syntax_dashql_generated.h"
#include "dashql/proto/syntax_generated.h"
#include "dashql/proto/syntax_sql_generated.h"
#include "pugixml.hpp"

namespace dashql {
namespace parser {

namespace sx = proto::syntax;
namespace sxs = proto::syntax_sql;
namespace sxd = proto::syntax_dashql;

namespace {

constexpr size_t INLINE_LOCATION_CAP = 20;
constexpr size_t LOCATION_HINT_LENGTH = 10;

std::string escape(std::string_view in) {
    std::string out{in};
    for (size_t i = out.find("\n", 0); i != std::string::npos; i = out.find("\n", i)) {
        out.replace(i, 1, " ");
        i += 1;
    }
    return out;
}

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
            ss << escape(text.substr(loc.offset(), loc.length()));
        } else {
            auto prefix = escape(text.substr(loc.offset(), LOCATION_HINT_LENGTH));
            auto suffix = escape(text.substr(loc.offset() + loc.length() - LOCATION_HINT_LENGTH, LOCATION_HINT_LENGTH));
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
void EncodeProgramTest(pugi::xml_node& root, const proto::syntax::ProgramT& program, std::string_view text) {
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
                    if (node_type_id > static_cast<uint32_t>(sx::NodeType::OBJECT_MIN)) {
                        n.append_attribute("type") = node_type_tt->names[static_cast<size_t>(target->node_type())];
                        encode(n, target->location(), text);
                        auto begin = target->children_begin_or_value();
                        for (auto i = 0; i < target->children_count(); ++i) {
                            pending.push_back({n.append_child("node"), &nodes[begin + i]});
                        }
                    } else if (node_type_id > static_cast<uint32_t>(sx::NodeType::ENUM_MIN)) {
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

}  // namespace parser
}  // namespace dashql
