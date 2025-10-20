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
struct ParserDFSNode {
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
    IntrusiveList<PlanViewModel::ParsedOperatorNode> child_operators;

    /// Constructor
    ParserDFSNode(rapidjson::Value& json_value, std::optional<size_t> parent_node_index,
                  PlanViewModel::PathComponent parent_child_type)
        : json_value(json_value), parent_node_index(parent_node_index), parent_child_type(parent_child_type) {}
};

/// A path builder
struct AncestorPathBuilder {
    /// The current path
    std::vector<PlanViewModel::PathComponent> path;
    /// Build an ancestor path
    std::pair<std::optional<size_t>, std::vector<PlanViewModel::PathComponent>> findAncestor(
        std::span<ParserDFSNode> nodes, size_t next);
};

/// Build an ancestor path
std::pair<std::optional<size_t>, std::vector<PlanViewModel::PathComponent>> AncestorPathBuilder::findAncestor(
    std::span<ParserDFSNode> nodes, size_t next) {
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

PlanViewModel::PlanViewModel() {}

buffers::status::StatusCode PlanViewModel::ParseHyperPlan(std::string plan_json) {
    AncestorPathBuilder path_builder;

    // Parse the document.
    // Note that ParseInsitu is destructive, plan_json will no longer hold valid json afterwards.
    document.ParseInsitu<PARSE_FLAGS>(plan_json.data());
    if (document.HasParseError()) {
        return buffers::status::StatusCode::VIEWMODEL_INPUT_JSON_PARSER_ERROR;
    }

    // Run DFS over the json plan
    std::vector<ParserDFSNode> pending;
    pending.emplace_back(document, std::nullopt, std::monostate{});
    do {
        ParserDFSNode& current = pending.back();
        auto current_index = pending.size() - 1;

        // Already visited?
        if (current.visited) {
            // Is an operator?
            if (current.operator_type.has_value()) {
                // Build the ancestor path
                auto [ancestor, ancestor_path] = path_builder.findAncestor(pending, &current - pending.data());
                // Then emit the node.
                auto& op = parsed_operators.PushBack(PlanViewModel::ParsedOperatorNode{
                    std::move(ancestor_path), current.json_value, current.operator_type.value(),
                    current.child_operators.CastAsBase()});
                if (ancestor.has_value()) {
                    // Register as child operator in ancestor
                    pending[ancestor.value()].child_operators.PushBack(op);
                } else {
                    // No parent operator, register as root
                    root_operators.push_back(op);
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
                        pending[current_index].operator_type = iter->value.GetString();
                    } else {
                        // Remember as attribute
                        pending[current_index].attributes.emplace_back(attribute_name, iter->value);
                        // Mark pending for DFS traversal
                        pending.emplace_back(iter->value, current_index, MemberInObject(attribute_name));
                    }
                }
                break;
            }
            // Current node is an array:
            // - Add children for DFS
            case rapidjson::Type::kArrayType: {
                auto values = current.json_value.GetArray();
                for (size_t i = values.Size(); i > 0; --i) {
                    size_t j = i - 1;
                    auto& child_value = values[j];
                    pending.emplace_back(child_value, current_index, EntryInArray(j));
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

    FlattenOperators();

    return buffers::status::StatusCode::OK;
}

void PlanViewModel::FlattenOperators() {
    // A DFS node
    struct OperatorDFSNode {
        /// The operator
        std::reference_wrapper<ParsedOperatorNode> op;
        /// Is visited
        bool visited;
    };

    // Prepare the operators
    std::vector<OperatorDFSNode> pending;
    for (auto iter = root_operators.rbegin(); iter != root_operators.rend(); ++iter) {
        pending.push_back({.op = *iter, .visited = false});
    }
    flat_operators.reserve(parsed_operators.GetSize());

    // Run the DFS
    std::unordered_map<const ParsedOperatorNode*, FlatOperatorNode> mapped;
    while (!pending.empty()) {
        auto& current = pending.back();
        auto current_index = pending.size() - 1;
        auto& op = current.op.get();

        // Translate nodes in DFS post-order
        if (current.visited) {
            // Translate children
            auto& parsed_children = op.child_operators.CastUnsafeAs<ParsedOperatorNode>();
            size_t children_begin = flat_operators.size();

            // Add child operators
            for (auto& child : parsed_children) {
                auto iter = mapped.find(&child);
                assert(iter != mapped.end());
                assert(flat_operators.size() < flat_operators.capacity());
                flat_operators.push_back(std::move(iter->second));
                flat_operators.back().operator_id = flat_operators.size() - 1;
                mapped.erase(iter);
            }
            size_t child_count = flat_operators.size() - children_begin;
            FlatOperatorNode sealed{std::move(op)};
            sealed.child_operators = {flat_operators.data() + children_begin, child_count};

            // Register sealed operator
            mapped.insert({&op, std::move(sealed)});
            pending.pop_back();
        } else {
            current.visited = true;

            // Add the children
            auto& children = op.child_operators.CastUnsafeAs<ParsedOperatorNode>();
            size_t children_begin = pending.size();
            for (auto& child : children) {
                pending.push_back(OperatorDFSNode{
                    .op = child,
                    .visited = false,
                });
            }
            // Reverse the pending items since we're using a DFS stack
            std::reverse(pending.begin() + children_begin, pending.end());
        }
    }

    // Now the map should only contain root operators
    assert(mapped.size() == root_operators.size());
    flat_root_operators.reserve(mapped.size());
    for (auto& [k, v] : mapped) {
        flat_root_operators.push_back(v.operator_id);
    }
}

PlanViewModel::FlatOperatorNode::FlatOperatorNode(const FlatOperatorNode& other)
    : parent_child_path(other.parent_child_path),
      json_value(other.json_value),
      operator_attributes(other.operator_attributes),
      child_operators(other.child_operators) {}

PlanViewModel::FlatOperatorNode::FlatOperatorNode(ParsedOperatorNode&& op)
    : parent_child_path(std::move(op.parent_child_path)),
      json_value(op.json_value),
      operator_attributes(op.operator_attributes),
      child_operators() {}

size_t PlanViewModel::StringDictionary::Allocate(std::string_view s) {
    if (auto iter = string_ids.find(s); iter != string_ids.end()) {
        return iter->second;
    } else {
        size_t id = strings.size();
        string_ids.insert({s, id});
        strings.push_back(std::string{s});
        return id;
    }
}

buffers::view::PlanOperator PlanViewModel::FlatOperatorNode::Pack(flatbuffers::FlatBufferBuilder& builder,
                                                                  const PlanViewModel& viewModel,
                                                                  StringDictionary& strings) const {
    buffers::view::PlanOperator op;
    op.mutate_operator_id(operator_id);
    op.mutate_operator_type_name(strings.Allocate(operator_type));
    op.mutate_children_begin(child_operators.data() - viewModel.flat_operators.data());
    op.mutate_children_count(child_operators.size());
    return op;
}

flatbuffers::Offset<buffers::view::PlanViewModel> PlanViewModel::Pack(flatbuffers::FlatBufferBuilder& builder) const {
    // Track strings in a dictionary for flabuffer
    StringDictionary dictionary;

    // Pack plan operators
    buffers::view::PlanOperator* op_writer = nullptr;
    auto flat_ops_ofs = builder.CreateUninitializedVectorOfStructs(flat_operators.size(), &op_writer);
    for (auto& op : flat_operators) {
        *(op_writer++) = op.Pack(builder, *this, dictionary);
    }
    auto flat_roots_ofs = builder.CreateVector(flat_root_operators);

    // Write the strings
    auto string_dictionary_ofs = builder.CreateVectorOfStrings(dictionary.strings);

    buffers::view::PlanViewModelBuilder vm{builder};
    vm.add_string_dictionary(string_dictionary_ofs);
    vm.add_operators(flat_ops_ofs);
    vm.add_root_operators(flat_roots_ofs);

    return vm.Finish();
}

}  // namespace dashql
