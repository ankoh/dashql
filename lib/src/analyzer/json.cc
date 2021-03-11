#include "dashql/analyzer/analyzer.h"
#include "dashql/parser/grammar/enums.h"
#include "dashql/parser/grammar/options.h"
#include "dashql/proto_generated.h"
#include "rapidjson/writer.h"

namespace dashql {

void readOptionsAsJSON(ProgramInstance& instance, size_t node_id, rapidjson::Document& out, bool copy) {
    /// Use a single post-order DFS to build the json outument with the SAX API
    auto& nodes = instance.program().nodes;
    std::stack<std::tuple<const sx::Node*, std::optional<rapidjson::Type>, size_t>> pending;
    pending.push({&nodes[node_id], std::nullopt, 0});
    while (pending.empty()) {
        auto& [node, type, children] = pending.top();

        // Type already set?
        // That means we visited the nodes children already.
        if (type.has_value()) {
            switch (type.value()) {
                case rapidjson::Type::kArrayType:
                    out.EndArray(children);
                    break;
                case rapidjson::Type::kObjectType:
                    out.EndObject(children);
                    break;
                default:
                    break;
            }
            pending.pop();
            continue;
        }

        // Not visited yet, is option?
        if (node->attribute_key() != sx::AttributeKey::NONE) {
            auto text = parser::optionToString(node->attribute_key());
            out.Key(text.data(), text.length(), false);  // never copy constant strings
        }

        // Not visited yet, check node type
        switch (node->node_type()) {
            case sx::NodeType::NONE:
                pending.pop();
                break;
            case sx::NodeType::BOOL:
                out.Bool(node->children_begin_or_value());
                pending.pop();
                break;
            case sx::NodeType::UI32_BITMAP:
            case sx::NodeType::UI32:
                out.Uint(node->children_begin_or_value());
                pending.pop();
                break;
            case sx::NodeType::STRING_REF: {
                auto txt = instance.TextAt(node->location());
                out.String(txt.data(), txt.length(), copy);
                pending.pop();
                break;
            }
            case sx::NodeType::ARRAY: {
                out.StartArray();
                type = rapidjson::Type::kArrayType;
                auto begin = node->children_begin_or_value();
                for (auto i = 0; i < node->children_count(); ++i) {
                    auto& child = nodes[begin + i];
                    if (child.node_type() == sx::NodeType::NONE || child.attribute_key() != sx::AttributeKey::NONE)
                        continue;
                    ++children;
                    pending.push({&child, std::nullopt, 0});
                }
                break;
            }
            default: {
                auto node_type_id = static_cast<uint32_t>(node->node_type());
                if (node_type_id > static_cast<uint32_t>(sx::NodeType::OBJECT_KEYS_)) {
                    out.StartObject();
                    type = rapidjson::Type::kObjectType;
                    auto begin = node->children_begin_or_value();
                    for (auto i = 0; i < node->children_count(); ++i) {
                        auto& child = nodes[begin + i];
                        if (child.node_type() == sx::NodeType::NONE ||
                            child.attribute_key() <= sx::AttributeKey::DASHQL_OPTION_KEYS_ ||
                            child.attribute_key() >= sx::AttributeKey::SQL_KEYS_)
                            continue;
                        ++children;
                        pending.push({&child, std::nullopt, 0});
                    }
                } else if (node_type_id > static_cast<uint32_t>(sx::NodeType::ENUM_KEYS_)) {
                    std::string_view txt = parser::getEnumText(*node);
                    out.String(txt.data(), txt.length(), false);  // never copy constant strings
                    pending.pop();
                } else {
                    pending.pop();
                }
            }
        }
    }
}

}  // namespace dashql