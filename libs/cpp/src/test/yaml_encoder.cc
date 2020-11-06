#include "dashql/parser/test/yaml_encoder.h"

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

namespace {

constexpr size_t INLINE_LOCATION_CAP = 20;
constexpr size_t LOCATION_HINT_LENGTH = 10;

std::string escape(std::string_view in) {
    std::string out{in};
    for (size_t i = out.find("\n", 0); i != std::string::npos; i = out.find("\n", i)) {
        out.replace(i, 1, "\\n");
        i += 2;
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

void encode(ryml::NodeRef e, const proto::syntax::Error& err, std::string_view text) {
    e |= ryml::MAP;
    e["message"] = c4::to_csubstr(err.message()->c_str());
    encode(e["location"], *err.location(), text);
}

}  // namespace

/// Encode yaml
void EncodeTestExpectation(ryml::NodeRef root, const proto::syntax::Module& module, std::string_view text) {
    auto& tree = *root.tree();
    root |= ryml::MAP;

    // Unpack modules
    auto* nodes = module.nodes();
    auto* statements = module.statements();
    auto* node_type_tt = proto::syntax::NodeTypeTypeTable();
    auto* attr_key_tt = proto::syntax::AttributeKeyTypeTable();

    // Add the statements list
    auto stmts_seq = root["statements"];
    stmts_seq |= ryml::SEQ;

    // Translate statements
    for (unsigned stmt_id = 0; stmt_id < statements->size(); ++stmt_id) {
        // Translate the statement tree with a DFS
        auto n = nodes->Get(statements->Get(stmt_id));
        std::vector<std::tuple<ryml::NodeRef, std::string_view, const sx::Node*>> pending;
        pending.push_back({stmts_seq, {}, n});

        while (!pending.empty()) {
            auto [parent, key, target] = pending.back();
            pending.pop_back();

            // Add or append to parent
            auto n = key.empty() ? parent.append_child() : parent[c4::csubstr(key.data(), key.size())];

            // Check node type
            switch (target->node_type()) {
                case sx::NodeType::NONE:
                    break;
                case sx::NodeType::UI32: {
                    n |= ryml::VAL;
                    n << target->children_begin_or_value();
                    break;
                }
                case sx::NodeType::STRING: {
                    encode(n, target->location(), text);
                    break;
                }
                case sx::NodeType::ARRAY: {
                    n |= ryml::SEQ;
                    auto end = target->children_begin_or_value() + target->children_count();
                    for (auto i = 0; i < target->children_count(); ++i) {
                        pending.push_back({n, {}, nodes->Get(end - i - 1)});
                    }
                    break;
                }
                default: {
                    n |= ryml::MAP;
                    auto end = target->children_begin_or_value() + target->children_count();
                    n["type"] = c4::to_csubstr(node_type_tt->names[static_cast<size_t>(target->node_type())]);
                    encode(n["location"], target->location(), text);
                    for (auto i = 0; i < target->children_count(); ++i) {
                        auto attr = nodes->Get(end - i - 1);
                        auto attr_key = std::string_view(attr_key_tt->names[static_cast<size_t>(attr->attribute_key())]);
                        pending.push_back({n, attr_key, attr});
                    }
                    break;
                }
            }
        }
    }

    // Add errors
    auto errors = root["errors"];
    errors |= ryml::SEQ;
    for (auto err : *module.errors()) encode(errors.append_child(), *err, text);

    // Add line breaks
    auto line_breaks = root["line_breaks"];
    line_breaks |= ryml::SEQ;
    for (auto err : *module.line_breaks()) encode(line_breaks.append_child(), *err, text);

    // Add comments
    auto comments = root["comments"];
    comments |= ryml::SEQ;
    for (auto err : *module.comments()) encode(comments.append_child(), *err, text);
}

}  // namespace parser
}  // namespace dashql
