#include "dashql/analyzer/json.h"

#include <rapidjson/document.h>

#include <cctype>
#include <iomanip>
#include <stack>
#include <variant>

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

struct UnvisitedNode {
    size_t node_id;
    std::optional<rapidjson::Type> type;
    size_t children;
};

template <typename Writer>
static void writeOptions(ProgramInstance& instance, size_t root_node_id, Writer& out) {
    std::string tmp;

    /// Use a single post-order DFS to build the json output.
    auto& nodes = instance.program().nodes;
    std::vector<UnvisitedNode> pending;
    pending.push_back(UnvisitedNode{root_node_id, std::nullopt, 0});
    while (!pending.empty()) {
        // Get the unvisited child node
        auto next = pending.back();
        auto node_stack_id = pending.size() - 1;
        auto& node = nodes[next.node_id];

        // Type already set?
        // That means we visited the nodes children already and are on our way up.
        if (next.type.has_value()) {
            switch (next.type.value()) {
                case rapidjson::Type::kArrayType:
                    out.EndArray(next.children);
                    break;
                case rapidjson::Type::kObjectType:
                    out.EndObject(next.children);
                    break;
                default:
                    break;
            }
            pending.pop_back();
            continue;
        }

        // Not visited yet, is option?
        // If yes, emit the key.
        // We don't emit other attribute keys!
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
                pending.pop_back();
                break;
            case sx::NodeType::BOOL:
                out.Bool(node.children_begin_or_value());
                pending.pop_back();
                break;
            case sx::NodeType::UI32_BITMAP:
            case sx::NodeType::UI32:
                out.Uint(node.children_begin_or_value());
                pending.pop_back();
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
                pending.pop_back();
                break;
            }
            case sx::NodeType::ARRAY: {
                pending.back().type = rapidjson::Type::kArrayType;
                auto begin = node.children_begin_or_value();
                auto count = node.children_count();
                auto end = begin + count;
                for (auto i = 0; i < count; ++i) {
                    auto& child = nodes[end - i - 1];
                    if (child.node_type() == sx::NodeType::NONE || child.attribute_key() != sx::AttributeKey::NONE)
                        continue;
                    pending.push_back(UnvisitedNode{end - i - 1, std::nullopt, 0});
                }
                pending[node_stack_id].children = pending.size() - node_stack_id - 1;

                // Start an array
                out.StartArray();
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
                        pending.pop_back();
                        break;
                    }

                    // Visit all children
                    pending.back().type = rapidjson::Type::kObjectType;
                    auto begin = node.children_begin_or_value();
                    auto count = node.children_count();
                    auto end = begin + count;
                    for (auto i = 0; i < count; ++i) {
                        // Skip if not option
                        auto& child = nodes[end - i - 1];
                        if (child.node_type() == sx::NodeType::NONE ||
                            child.attribute_key() <= sx::AttributeKey::DASHQL_OPTION_KEYS_ ||
                            child.attribute_key() >= sx::AttributeKey::SQL_KEYS_) {
                            continue;
                        }
                        pending.push_back(UnvisitedNode{end - i - 1, std::nullopt, 0});
                    }
                    pending[node_stack_id].children = pending.size() - node_stack_id - 1;

                    // Start an object
                    out.StartObject();

                } else if (node_type_id > static_cast<uint32_t>(sx::NodeType::ENUM_KEYS_)) {
                    std::string_view txt = parser::getEnumText(node);
                    out.String(txt.data(), txt.length(), false);  // never copy constant strings
                    pending.pop_back();
                } else {
                    pending.pop_back();
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

struct SQLJSONWriter : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, SQLJSONWriter> {
    std::ostream& out;
    std::vector<std::pair<NodeType, size_t>> node_stack;

    SQLJSONWriter(std::ostream& out) : out(out) {}

    bool Key(const char* txt, size_t length, bool copy) {
        auto& [node_type, children] = node_stack.back();
        assert(node_type == NodeType::OBJECT);
        if (children++ == 0) {
            out << "(\n";
        } else {
            out << ",\n";
        }
        std::fill_n(std::ostream_iterator<char>{out}, node_stack.size() * INDENTATION_CHARS, ' ');
        out << std::string_view{txt, length};
        out << " = ";
        return true;
    }
    void NextValue() {
        auto& [node_type, children] = node_stack.back();
        if (node_type == NodeType::ARRAY) {
            children++;
            out << "[";
        }
    }
    bool Bool(bool v) {
        NextValue();
        out << v;
        return true;
    }
    bool String(const char* txt, size_t length, bool copy) {
        NextValue();
        out << std::quoted(std::string_view{txt, length}, '\'');
        return true;
    }
    bool Int(int32_t v) {
        NextValue();
        out << v;
        return true;
    }
    bool Int64(int64_t v) {
        NextValue();
        out << v;
        return true;
    }
    bool Uint(uint32_t v) {
        NextValue();
        out << v;
        return true;
    }
    bool Uint64(uint64_t v) {
        NextValue();
        out << v;
        return true;
    }
    bool Double(double v) {
        NextValue();
        out << v;
        return true;
    }
    bool StartObject() {
        node_stack.push_back({NodeType::OBJECT, 0});
        return true;
    }
    bool StartArray() {
        node_stack.push_back({NodeType::ARRAY, 0});
        return true;
    }
    bool EndObject(size_t count) {
        if (node_stack.back().second > 0) {
            out << "\n";
            node_stack.pop_back();
            std::fill_n(std::ostream_iterator<char>{out}, node_stack.size() * INDENTATION_CHARS, ' ');
            out << ")";
        } else {
            node_stack.pop_back();
        }
        return true;
    }
    bool EndArray(size_t count) {
        if (node_stack.back().second > 0) out << "]";
        node_stack.pop_back();
        return true;
    }
};

}  // namespace

// Read all options as DOM
rapidjson::Document readOptionsAsDOM(ProgramInstance& instance, size_t node_id) {
    rapidjson::Document doc;
    auto generator = [&](auto& reader) {
        writeOptions(instance, node_id, reader);
        return true;
    };
    doc.Populate(generator);
    return doc;
}

// Write document as SQLJSON
void writeSQLJSON(const rapidjson::Document& doc, std::ostream& out) {
    SQLJSONWriter writer{out};
    doc.Accept(writer);
}

// Write all options directly as JSON.
// This is more efficient than SQLJSON since we don't materialize an intermediate DOM.
void writeOptionsAsJSON(ProgramInstance& instance, size_t node_id, std::ostream& raw_out, bool pretty) {
    rapidjson::OStreamWrapper out{raw_out};
    if (pretty) {
        rapidjson::PrettyWriter writer{out};
        writeOptions(instance, node_id, writer);
    } else {
        rapidjson::Writer writer{out};
        writeOptions(instance, node_id, writer);
    }
}

}  // namespace dashql