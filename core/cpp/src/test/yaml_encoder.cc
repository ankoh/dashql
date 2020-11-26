#include "dashql/test/yaml_encoder.h"

#include "dashql/proto/syntax_generated.h"
#include "dashql/proto/syntax_sql_generated.h"
#include "dashql/proto/syntax_dashql_generated.h"

#include <cstdint>
#include <regex>
#include <sstream>
#include <stack>
#include <unordered_set>
#include <iostream>

#include "c4/yml/std/string.hpp"
#include "c4/yml/yml.hpp"
#include "ryml.hpp"
#include "ryml_std.hpp"

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

void encode(ryml::NodeRef n, proto::syntax::Location loc, std::string_view text) {
    n |= ryml::VAL;

    auto begin = loc.offset();
    auto end = loc.offset() + loc.length();

    std::stringstream ss;
    ss << begin << ".." << end;
    if (loc.length() < INLINE_LOCATION_CAP) {
        ss << "|`" << escape(text.substr(loc.offset(), loc.length())) << "`";
    } else {
        auto prefix = escape(text.substr(loc.offset(), LOCATION_HINT_LENGTH));
        auto suffix = escape(text.substr(loc.offset() + loc.length() - LOCATION_HINT_LENGTH, LOCATION_HINT_LENGTH));
        ss << "|`" << prefix << "`..`" << suffix << "`";
    }
    n << ss.str();
}

void encode(ryml::NodeRef e, const proto::syntax::ErrorT& err, std::string_view text) {
    e |= ryml::MAP;
    e["message"] = c4::to_csubstr(err.message.c_str());
    encode(e["location"], *err.location, text);
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


void encode(ryml::NodeRef n, const sx::Dependency& dep, sx::Location loc, std::string_view text) {
    n |= ryml::MAP;
    n["type"] << sx::DependencyTypeTypeTable()->names[static_cast<size_t>(dep.type())];
    n["source"] << dep.source_statement();
    n["target"] << dep.target_statement();
    encode(n["target_node"], loc, text);
}

}  // namespace

/// Encode yaml
void EncodeTestExpectation(ryml::NodeRef root, const proto::syntax::ProgramT& program, std::string_view text) {
    auto& tree = *root.tree();
    root |= ryml::MAP;

    // Unpack modules
    auto& nodes = program.nodes;
    auto& statements = program.statements;
    auto* node_type_tt = proto::syntax::NodeTypeTypeTable();
    auto* attr_key_tt = proto::syntax::AttributeKeyTypeTable();

    // Add the statements list
    auto stmts_seq = root["statements"];
    stmts_seq |= ryml::SEQ;

    // Translate the statement tree with a DFS
    for (unsigned stmt_id = 0; stmt_id < statements.size(); ++stmt_id) {
        auto& s = *statements[stmt_id];

        auto stmt = stmts_seq.append_child();
        stmt |= ryml::MAP;
        if (!s.target_name_qualified.empty())
            stmt["name"] << s.target_name_qualified.c_str();

        std::vector<std::tuple<ryml::NodeRef, std::string_view, const sx::Node*>> pending;
        pending.push_back({stmt, "root", &nodes[s.root]});

        while (!pending.empty()) {
            auto [parent, key, target] = pending.back();
            pending.pop_back();

            // Add or append to parent
            auto n = key.empty() ? parent.append_child() : parent[c4::csubstr(key.data(), key.size())];

            // Check node type
            switch (target->node_type()) {
                case sx::NodeType::NONE:
                    break;
                case sx::NodeType::BOOL: {
                    n |= ryml::VAL;
                    n << (target->children_begin_or_value() != 0 ? "true" : "false");
                    break;
                }
                case sx::NodeType::UI32: {
                    n |= ryml::VAL;
                    n << target->children_begin_or_value();
                    break;
                }
                case sx::NodeType::STRING_REF: {
                    encode(n, target->location(), text);
                    break;
                }
                case sx::NodeType::ARRAY: {
                    n |= ryml::SEQ;
                    auto end = target->children_begin_or_value() + target->children_count();
                    for (auto i = 0; i < target->children_count(); ++i) {
                        pending.push_back({n, {}, &nodes[end - i - 1]});
                    }
                    break;
                }
                default: {
                    auto node_type_id = static_cast<uint32_t>(target->node_type());
                    if (node_type_id > static_cast<uint32_t>(sx::NodeType::OBJECT_MIN)) {
                        n |= ryml::MAP;
                        auto end = target->children_begin_or_value() + target->children_count();
                        n["type"] = c4::to_csubstr(node_type_tt->names[static_cast<size_t>(target->node_type())]);
                        encode(n["location"], target->location(), text);
                        for (auto i = 0; i < target->children_count(); ++i) {
                            auto& attr = nodes[end - i - 1];
                            auto attr_key = std::string_view(attr_key_tt->names[static_cast<size_t>(attr.attribute_key())]);
                            pending.push_back({n, attr_key, &attr});
                        }
                    } else if (node_type_id > static_cast<uint32_t>(sx::NodeType::ENUM_MIN)) {
                        n |= ryml::VAL;
                        n << getEnumText(*target);
                    } else {
                        n |= ryml::VAL;
                        n << target->children_begin_or_value();
                    }
                    break;
                }
            }
        }
    }

    // Add errors
    auto errors = root["errors"];
    errors |= ryml::SEQ;
    for (auto& err : program.errors) encode(errors.append_child(), *err, text);

    // Add line breaks
    auto line_breaks = root["line_breaks"];
    line_breaks |= ryml::SEQ;
    for (auto& lb : program.line_breaks)
        encode(line_breaks.append_child(), lb, text);

    // Add comments
    auto comments = root["comments"];
    comments |= ryml::SEQ;
    for (auto& comment : program.comments) encode(comments.append_child(), comment, text);

    // Add comments
    auto dependencies = root["dependencies"];
    dependencies |= ryml::SEQ;
    for (auto& dep : program.dependencies) {
        auto loc = program.nodes[dep.target_node()].location();
        encode(dependencies.append_child(), dep, loc, text);
    };
}

}  // namespace parser
}  // namespace dashql
