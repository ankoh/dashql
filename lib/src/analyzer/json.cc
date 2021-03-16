#include "dashql/analyzer/json.h"

#include <cctype>
#include <iomanip>
#include <stack>

#include "dashql/analyzer/analyzer.h"
#include "dashql/common/memstream.h"
#include "dashql/common/string.h"
#include "dashql/parser/grammar/enums.h"
#include "dashql/parser/grammar/options.h"
#include "dashql/proto_generated.h"
#include "rapidjson/ostreamwrapper.h"
#include "rapidjson/prettywriter.h"
#include "rapidjson/writer.h"

namespace dashql {

template <typename Writer>
static void writeOptionsAsJSONImpl(ProgramInstance& instance, size_t root_node_id, Writer& out) {
    std::string tmp;

    /// Use a single post-order DFS to build the json outument with the SAX API
    auto& nodes = instance.program().nodes;
    std::stack<std::tuple<size_t, std::optional<rapidjson::Type>, size_t>> pending;
    pending.push({root_node_id, std::nullopt, 0});
    while (!pending.empty()) {
        auto& [node_id, type, children] = pending.top();
        auto& node = nodes[node_id];

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
        if (node.attribute_key() != sx::AttributeKey::NONE) {
            auto text = parser::optionToString(node.attribute_key());
            if (!text.empty()) {
                auto key = parser::optionToCamelCase(text, tmp);
                out.Key(key.data(), key.length(), true);
            };
        }

        // Not visited yet, check node type
        switch (node.node_type()) {
            case sx::NodeType::NONE:
                pending.pop();
                break;
            case sx::NodeType::BOOL:
                out.Bool(node.children_begin_or_value());
                pending.pop();
                break;
            case sx::NodeType::UI32_BITMAP:
            case sx::NodeType::UI32:
                out.Uint(node.children_begin_or_value());
                pending.pop();
                break;
            case sx::NodeType::STRING_REF: {
                auto txt = trimview(instance.TextAt(node.location()), isNoQuote);
                double v;
                imemstream trydouble{txt.data(), txt.length()};
                trydouble >> v;
                if (!trydouble.fail()) {
                    out.Double(v);
                } else {
                    out.String(txt.data(), txt.length(), false);
                }
                pending.pop();
                break;
            }
            case sx::NodeType::ARRAY: {
                out.StartArray();
                type = rapidjson::Type::kArrayType;
                auto begin = node.children_begin_or_value();
                for (auto i = 0; i < node.children_count(); ++i) {
                    auto& child = nodes[begin + i];
                    if (child.node_type() == sx::NodeType::NONE || child.attribute_key() != sx::AttributeKey::NONE)
                        continue;
                    ++children;
                    pending.push({begin + i, std::nullopt, 0});
                }
                break;
            }
            default: {
                // Is an object?
                auto node_type_id = static_cast<uint32_t>(node.node_type());
                if (node_type_id > static_cast<uint32_t>(sx::NodeType::OBJECT_KEYS_)) {
                    // Flatten object?
                    // We do not want to bother JS with the AST in JSON.
                    bool flatten = false;
                    switch (node.node_type()) {
                        case sx::NodeType::OBJECT_DASHQL_FUNCTION_CALL:
                        case sx::NodeType::OBJECT_SQL_COLUMN_REF:
                            flatten = true;
                            break;
                        default:
                            break;
                    }
                    if (flatten) {
                        auto txt = trimview(instance.TextAt(node.location()), isNoQuote);
                        out.String(txt.data(), txt.length(), false);  // XXX Maybe emit numbers as well?
                        pending.pop();
                        break;
                    }

                    // Otherwise emit an object
                    out.StartObject();

                    // Visit all children
                    type = rapidjson::Type::kObjectType;
                    auto begin = node.children_begin_or_value();
                    auto end = begin + node.children_count() - 1;
                    for (auto i = 0; i < node.children_count(); ++i) {
                        // Skip if not option
                        auto& child = nodes[end - i];
                        if (child.node_type() == sx::NodeType::NONE ||
                            child.attribute_key() <= sx::AttributeKey::DASHQL_OPTION_KEYS_ ||
                            child.attribute_key() >= sx::AttributeKey::SQL_KEYS_) {
                            continue;
                        }
                        ++children;
                        pending.push({end - i, std::nullopt, 0});
                    }
                } else if (node_type_id > static_cast<uint32_t>(sx::NodeType::ENUM_KEYS_)) {
                    std::string_view txt = parser::getEnumText(node);
                    out.String(txt.data(), txt.length(), false);  // never copy constant strings
                    pending.pop();
                } else {
                    pending.pop();
                }
            }
        }
    }
}

namespace {

constexpr size_t INDENTATION_CHARS = 4;

enum NodeType {
    OBJECT,
    ARRAY,
};

struct SQLJSONWriter {
    std::ostream& out;
    std::stack<std::pair<NodeType, size_t>> node_stack;

    SQLJSONWriter(std::ostream& out) : out(out) {}

    void Key(const char* txt, size_t length, bool copy) {
        auto& [node_type, children] = node_stack.top();
        assert(node_type == NodeType::OBJECT);
        if (children++ == 0) {
            out << "(\n";
        } else {
            out << ",\n";
        }
        std::fill_n(std::ostream_iterator<char>{out}, node_stack.size() * INDENTATION_CHARS, ' ');
        out << std::string_view{txt, length};
        out << " = ";
    }
    void NextValue() {
        auto& [node_type, children] = node_stack.top();
        if (node_type == NodeType::ARRAY) {
            children++;
            out << "[";
        }
    }
    void Bool(bool v) {
        NextValue();
        out << v;
    }
    void String(const char* txt, size_t length, bool copy) {
        NextValue();
        out << std::quoted(std::string_view{txt, length}, '\'');
    }
    void Uint(uint64_t v) {
        NextValue();
        out << v;
    }
    void Double(double v) {
        NextValue();
        out << v;
    }
    void StartObject() { node_stack.push({NodeType::OBJECT, 0}); }
    void StartArray() { node_stack.push({NodeType::ARRAY, 0}); }
    void EndObject(size_t count) {
        if (node_stack.top().second > 0) {
            out << "\n";
            node_stack.pop();
            std::fill_n(std::ostream_iterator<char>{out}, node_stack.size() * INDENTATION_CHARS, ' ');
            out << ")";
        } else {
            node_stack.pop();
        }
    }
    void EndArray(size_t count) {
        if (node_stack.top().second > 0) out << "]";
        node_stack.pop();
    }
};

}  // namespace

void writeOptionsAsJSON(ProgramInstance& instance, size_t node_id, std::ostream& raw_out, JSONWriterType writer) {
    switch (writer) {
        case JSONWriterType::JSON: {
            rapidjson::OStreamWrapper out{raw_out};
            rapidjson::Writer writer{out};
            writeOptionsAsJSONImpl(instance, node_id, writer);
            break;
        }
        case JSONWriterType::JSON_PRETTY: {
            rapidjson::OStreamWrapper out{raw_out};
            rapidjson::PrettyWriter writer{out};
            writeOptionsAsJSONImpl(instance, node_id, writer);
            break;
        }
        case JSONWriterType::SQLJSON_PRETTY: {
            SQLJSONWriter writer{raw_out};
            writeOptionsAsJSONImpl(instance, node_id, writer);
            break;
        }
    }
}

}  // namespace dashql