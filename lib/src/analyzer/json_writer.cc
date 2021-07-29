#include "dashql/analyzer/json_writer.h"

#include <rapidjson/document.h>

#include <cctype>
#include <iomanip>
#include <stack>
#include <variant>

#include "dashql/analyzer/analyzer.h"
#include "dashql/analyzer/json_sax.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/common/memstream.h"
#include "dashql/common/string.h"
#include "dashql/parser/grammar/dson.h"
#include "dashql/parser/grammar/enums.h"
#include "dashql/proto_generated.h"
#include "rapidjson/ostreamwrapper.h"
#include "rapidjson/prettywriter.h"
#include "rapidjson/writer.h"

namespace dashql {
namespace json {

namespace {

constexpr size_t Script_INDENTATION_CHARS = 4;

struct ScriptWriter : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, ScriptWriter> {
    enum NodeType {
        OBJECT,
        ARRAY,
    };

    std::ostream& out;
    std::vector<std::pair<NodeType, size_t>> node_stack;

    ScriptWriter(std::ostream& out) : out(out), node_stack() {}

    bool Key(const char* txt, size_t length, bool copy) {
        auto& [node_type, children] = node_stack.back();
        assert(node_type == NodeType::OBJECT);
        if (children++ == 0) {
            out << "(\n";
        } else {
            out << ",\n";
        }
        std::fill_n(std::ostream_iterator<char>{out}, node_stack.size() * Script_INDENTATION_CHARS, ' ');
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
            std::fill_n(std::ostream_iterator<char>{out}, node_stack.size() * Script_INDENTATION_CHARS, ' ');
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

struct ExistingNode {
    size_t node_id;
    std::optional<rapidjson::Type> type;
    size_t children;
};
using DFSStep = std::variant<ExistingNode, const json::SAXDocument*>;

template <typename Writer>
static void write(ProgramInstance& instance, size_t root_node_id, json::DocumentPatch& patch, Writer& out,
                  bool only_dson) {
    std::string tmp;
    auto printNode = [only_dson](sx::Node& node) {
        return !only_dson || node.attribute_key() >= static_cast<size_t>(sx::AttributeKey::DSON_KEYS_);
    };

    /// Use a single post-order DFS to build the json output.
    auto& nodes = instance.program().nodes;
    std::vector<DFSStep> pending;
    pending.push_back(ExistingNode{.node_id = root_node_id, .type = std::nullopt, .children = 0});
    while (!pending.empty()) {
        // Get the unvisited child node
        auto& top = pending.back();

        // Is SAX node on DFS stack? - emit directly.
        // Could either be an attribute value or an array element.
        if (auto sax = std::get_if<const json::SAXDocument*>(&top); sax) {
            if ((*sax)->key != sx::AttributeKey::NONE) {
                auto key = instance.dson_dictionary().keyToStringForJSON(static_cast<uint16_t>((*sax)->key), tmp);
                out.Key(key.data(), key.length(), true);
            };
            (*sax)->Write(out);
            pending.pop_back();
            continue;
        }

        // Skip node?
        auto& next = std::get<ExistingNode>(top);
        if (patch.ignore.count(next.node_id)) {
            pending.pop_back();
            continue;
        }

        // Are there any patches attached to this node id?
        auto node = nodes[next.node_id];
        auto node_stack_id = pending.size() - 1;
        auto* to_append = patch.append.count(next.node_id) ? &patch.append.at(next.node_id) : nullptr;

        // Type already set?
        // That means we visited the nodes children already and are on our way up.
        // (Post-order DFS traversal)
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

        // Not visited yet?
        // Emit the key.
        if (node.attribute_key() != 0) {
            auto key = instance.dson_dictionary().keyToStringForJSON(static_cast<uint16_t>(node.attribute_key()), tmp);
            out.Key(key.data(), key.length(), true);
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
                next.type = rapidjson::Type::kArrayType;
                auto begin = node.children_begin_or_value();
                auto count = node.children_count();
                auto end = begin + count;
                // Push new nodes as last array elements (if any)
                if (to_append) {
                    for (auto iter = to_append->rbegin(); iter != to_append->rend(); ++iter) {
                        pending.push_back(&*iter);
                    }
                }
                // Push remaining elements
                for (auto i = 0; i < count; ++i) {
                    auto& child = nodes[end - i - 1];
                    if (child.node_type() == sx::NodeType::NONE) continue;
                    pending.push_back(ExistingNode{end - i - 1, std::nullopt, 0});
                }
                std::get<ExistingNode>(pending[node_stack_id]).children = pending.size() - node_stack_id - 1;

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

                    next.type = rapidjson::Type::kObjectType;
                    auto begin = node.children_begin_or_value();
                    auto count = node.children_count();
                    auto end = begin + count;
                    if (!to_append) {
                        // Collect all children
                        for (auto i = 0; i < count; ++i) {
                            auto& child = nodes[end - i - 1];
                            if (printNode(child)) {
                                pending.push_back(ExistingNode{end - i - 1, std::nullopt, 0});
                            }
                        }
                    } else {
                        // Push patched nodes as last array elements (if any)
                        std::sort(to_append->begin(), to_append->end(),
                                  [&](auto& l, auto& r) { return l.key < r.key; });
                        auto l = 0;
                        auto r = 0;
                        while (l < count && r < to_append->size()) {
                            auto lk = nodes[begin + l].attribute_key();
                            auto rk = static_cast<uint16_t>(to_append->at(r).key);
                            if (lk < rk) {
                                auto& child = nodes[begin + l];
                                if (printNode(child)) {
                                    pending.push_back(ExistingNode{begin + l, std::nullopt, 0});
                                }
                                ++l;
                            } else if (lk > rk) {
                                pending.push_back({&to_append->at(r)});
                                ++r;
                            } else {
                                pending.push_back({&to_append->at(r)});
                                ++l;
                                ++r;
                            }
                        }
                        for (; l < count; ++l) {
                            auto& child = nodes[begin + l];
                            if (printNode(child)) {
                                pending.push_back(ExistingNode{begin + l, std::nullopt, 0});
                            }
                        }
                        for (; r < to_append->size(); ++r) {
                            pending.push_back({&to_append->at(r)});
                        }
                        std::reverse(pending.begin() + node_stack_id + 1, pending.end());
                    }
                    // Set the correct amount of children
                    std::get<ExistingNode>(pending[node_stack_id]).children = pending.size() - node_stack_id - 1;
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

}  // namespace

DocumentWriter::DocumentWriter(ProgramInstance& instance, size_t node_id, const ASTIndex& ast)
    : instance_(instance), node_id_(node_id), patch_(ast) {}

// Read all options as DOM
// Write document as Script
void DocumentWriter::writeAsScript(std::ostream& out, bool pretty, bool only_dson) {
    ScriptWriter writer{out};
    write(instance_, node_id_, patch_, writer, only_dson);
}

// Write all options directly as JSON.
// This is more efficient than Script since we don't materialize an intermediate DOM.
void DocumentWriter::writeAsJSON(std::ostream& raw_out, bool pretty, bool only_dson) {
    rapidjson::OStreamWrapper out{raw_out};
    if (pretty) {
        rapidjson::PrettyWriter writer{out};
        write(instance_, node_id_, patch_, writer, only_dson);
    } else {
        rapidjson::Writer writer{out};
        write(instance_, node_id_, patch_, writer, only_dson);
    }
}

}  // namespace json
}  // namespace dashql
