#include "dashql/view/plan_view_model.h"

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/intrusive_list.h"
#include "rapidjson/document.h"
#include "rapidjson/rapidjson.h"
#include "rapidjson/reader.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

namespace dashql {

constexpr unsigned PARSE_FLAGS = rapidjson::ParseFlag::kParseCommentsFlag | rapidjson::ParseFlag::kParseNanAndInfFlag |
                                 rapidjson::ParseFlag::kParseTrailingCommasFlag |
                                 rapidjson::ParseFlag::kParseEscapedApostropheFlag |
                                 rapidjson::ParseFlag::kParseValidateEncodingFlag;

namespace {

// The logic is the following:
// - We do a post-order DFS traversal
// - Whenever we find an operator, we re-construct the path toward the lowest operator ancestor
struct DFSNode {
    /// The json value
    rapidjson::Value& json_value;
    /// The DFS visited marker for the post-order traversal
    bool visited = false;
    /// The parent index in the DFS
    std::optional<size_t> parent_node_index = std::nullopt;
    /// The refernce in the parent
    PlanViewModel::PathComponent parent_child_type = std::monostate{};
    /// Is an operator?
    std::optional<std::string_view> operator_type = std::nullopt;
    /// The attributes
    std::vector<std::pair<std::string_view, std::reference_wrapper<const rapidjson::Value>>> attributes;
    /// The already emitted children
    IntrusiveList<PlanViewModel::OperatorNode> child_operators;

    /// Constructor
    DFSNode(rapidjson::Value& json_value, std::optional<size_t> parent_node_index,
            PlanViewModel::PathComponent parent_child_type)
        : json_value(json_value), parent_node_index(parent_node_index), parent_child_type(parent_child_type) {}
};

/// A path builder
struct AncestorPathBuilder {
    /// The current path
    std::vector<PlanViewModel::PathComponent> path;
    /// Build an ancestor path
    std::pair<std::optional<size_t>, std::vector<PlanViewModel::PathComponent>> findAncestor(std::span<DFSNode> nodes,
                                                                                             size_t next);
};

/// Build an ancestor path
std::pair<std::optional<size_t>, std::vector<PlanViewModel::PathComponent>> AncestorPathBuilder::findAncestor(
    std::span<DFSNode> nodes, size_t next) {
    path.clear();

    // Check the current node
    auto& node = nodes[next];
    if (node.parent_node_index.has_value()) {
        path.push_back(node.parent_child_type);
        next = node.parent_node_index.value();
    } else {
        return {std::nullopt, {}};
    }

    // Walk upwards until we hit the root or an operator
    while (true) {
        auto& node = nodes[next];
        if (node.operator_type.has_value()) {
            return {next, std::move(path)};
        } else if (!node.parent_node_index.has_value()) {
            return {std::nullopt, std::move(path)};
        } else {
            path.push_back(node.parent_child_type);
            next = node.parent_node_index.value();
        }
    }
}

}  // namespace

std::pair<std::unique_ptr<PlanViewModel>, buffers::status::StatusCode> PlanViewModel::ParseHyperPlan(
    std::string plan_json) {
    auto view_model = std::make_unique<PlanViewModel>();
    AncestorPathBuilder path_builder;

    // Parse the document.
    // Note that ParseInsitu is destructive, plan_json will no longer hold valid json afterwards.
    view_model->document.ParseInsitu<PARSE_FLAGS>(plan_json.data());
    if (view_model->document.HasParseError()) {
        return {nullptr, buffers::status::StatusCode::VIEWMODEL_INPUT_JSON_PARSER_ERROR};
    }

    // Run DFS over the json plan
    std::vector<DFSNode> pending;
    pending.emplace_back(view_model->document, std::nullopt, std::monostate{});
    do {
        DFSNode current = pending.back();
        auto node_index = pending.size() - 1;

        // Already visited?
        if (current.visited) {
            // Is an operator?
            if (current.operator_type.has_value()) {
                // Build the ancestor path
                auto [ancestor, ancestor_path] = path_builder.findAncestor(pending, &current - pending.data());
                // Then emit the node.
                auto& op = view_model->operator_buffer.PushBack(PlanViewModel::OperatorNode{
                    current.json_value, std::move(ancestor_path), current.child_operators.CastAsBase()});
                if (ancestor.has_value()) {
                    // Register as child operator in ancestor
                    pending[ancestor.value()].child_operators.PushBack(op);
                } else {
                    // No parent operator, register as root
                    view_model->root_operator = &op;
                }
            } else {
                // Otherwise do nothing, we're serializing the attributes later
            }
            pending.pop_back();
            continue;
        }
        // Mark as visited
        current.visited = true;

        switch (current.json_value.GetType()) {
            // Current node is an object:
            // - Add children for DFS
            // - Check if it is an operator
            case rapidjson::Type::kObjectType: {
                auto o = current.json_value.GetObject();
                for (auto iter = o.MemberBegin(); iter != o.MemberEnd(); ++iter) {
                    assert(iter->name.IsString());
                    std::string_view attribute_name{iter->name.GetString()};

                    // Is the current node an operator?
                    if (attribute_name == "operator" && iter->value.IsString()) {
                        // Mark as such and skip attribute during DFS
                        current.operator_type = iter->value.GetString();
                    } else {
                        // Remember as attribute
                        current.attributes.emplace_back(attribute_name, iter->value);
                        // Mark pending for DFS traversal
                        pending.emplace_back(iter->value, node_index, MemberInObject(attribute_name));
                    }
                }
                break;
            }
            // Current node is an array:
            // - Add children for DFS
            case rapidjson::Type::kArrayType: {
                auto values = current.json_value.GetArray();
                for (size_t i = values.Size(); i > 0; ++i) {
                    size_t j = i - 1;
                    auto& child_value = values[j];
                    pending.emplace_back(child_value, node_index, EntryInArray(j));
                }
                break;
            }

            case rapidjson::Type::kFalseType:
            case rapidjson::Type::kNullType:
            case rapidjson::Type::kNumberType:
            case rapidjson::Type::kStringType:
            case rapidjson::Type::kTrueType:
                // Skip value nodes during DFS traversal
                break;
        }
    } while (!pending.empty());

    return {nullptr, buffers::status::StatusCode::OK};
}

}  // namespace dashql
