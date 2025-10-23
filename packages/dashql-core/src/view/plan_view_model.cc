#include "dashql/view/plan_view_model.h"

#include <sstream>
#include <string_view>

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/intrusive_list.h"

namespace dashql {

PlanViewModel::PlanViewModel() {}

PlanViewModel::Pipeline& PlanViewModel::RegisterPipeline() {
    uint32_t pipeline_id = pipelines.GetSize();
    return pipelines.PushBack({.pipeline_id = pipeline_id, .edges = {}});
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
                size_t operator_id = flat_operators.size();
                flat_operators.push_back(std::move(iter->second));
                flat_operators.back().operator_id = operator_id;
                for (auto& child : flat_operators.back().child_operators) {
                    child.parent_operator_id = operator_id;
                }
                mapped.erase(iter);
            }
            size_t child_count = flat_operators.size() - children_begin;
            FlatOperatorNode flat{std::move(op)};
            flat.child_operators = {flat_operators.data() + children_begin, child_count};

            // Register flat operator
            mapped.insert({&op, std::move(flat)});
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
        uint32_t oid = flat_operators.size();
        flat_operators.emplace_back(std::move(v));
        flat_operators.back().operator_id = oid;
        flat_root_operators.push_back(oid);
    }
}

size_t PlanViewModel::StringDictionary::Allocate(std::string&& s) {
    if (auto iter = string_ids.find(s); iter != string_ids.end()) {
        return iter->second;
    } else {
        size_t id = strings.GetSize();
        auto& stable = strings.PushBack(std::move(s));
        string_ids.insert({stable, id});
        return id;
    }
}

PlanViewModel::FlatOperatorNode::FlatOperatorNode(ParsedOperatorNode&& parsed)
    : operator_type(parsed.operator_type),
      parent_path(std::move(parsed.parent_child_path)),
      json_value(parsed.json_value),
      child_operators(),
      operator_attributes(std::move(parsed.operator_attributes)) {
    // Construct the attribute map
    operator_attribute_map.reserve(operator_attributes.size());
    for (auto& [k, v] : operator_attributes) {
        operator_attribute_map.insert({k, v});
    }
};

PlanViewModel::FlatOperatorNode::FlatOperatorNode(const FlatOperatorNode& other)
    : operator_type(other.operator_type),
      operator_id(other.operator_id),
      parent_path(other.parent_path),
      json_value(other.json_value),
      child_operators(other.child_operators),
      operator_attributes(other.operator_attributes),
      operator_attribute_map(other.operator_attribute_map) {}

PlanViewModel::FlatOperatorNode::FlatOperatorNode(FlatOperatorNode&& other)
    : operator_type(other.operator_type),
      operator_id(other.operator_id),
      parent_path(std::move(other.parent_path)),
      json_value(other.json_value),
      child_operators(other.child_operators),
      operator_attributes(std::move(other.operator_attributes)),
      operator_attribute_map(std::move(other.operator_attribute_map)) {}

std::string PlanViewModel::FlatOperatorNode::SerializeParentPath() const {
    std::stringstream ss;
    for (size_t i = 0; i < parent_path.size(); ++i) {
        auto& component = parent_path[i];
        std::visit(
            [&](const auto& ctx) -> void {
                using T = std::decay_t<decltype(ctx)>;
                if constexpr (std::is_same_v<T, MemberInObject>) {
                    if (i > 0) {
                        ss << ".";
                    }
                    ss << ctx.attribute;
                } else if constexpr (std::is_same_v<T, EntryInArray>) {
                    ss << "[" << ctx.index << "]";
                }
            },
            component);
    }
    return ss.str();
}

buffers::view::PlanOperator PlanViewModel::FlatOperatorNode::Pack(flatbuffers::FlatBufferBuilder& builder,
                                                                  const PlanViewModel& view_model,
                                                                  StringDictionary& strings) const {
    buffers::view::PlanOperator op;
    op.mutate_operator_id(operator_id);
    op.mutate_operator_type_name(strings.Allocate(operator_type));
    op.mutate_parent_operator_id(parent_operator_id.value_or(std::numeric_limits<uint32_t>::max()));
    op.mutate_parent_path(strings.Allocate(SerializeParentPath()));
    op.mutate_children_begin(child_operators.data() - view_model.flat_operators.data());
    op.mutate_children_count(child_operators.size());
    return op;
}

flatbuffers::Offset<buffers::view::PlanViewModel> PlanViewModel::Pack(flatbuffers::FlatBufferBuilder& builder) const {
    // Track strings in a dictionary for flabuffer
    StringDictionary dictionary;

    // Pack plan operators
    std::vector<buffers::view::PlanOperator> ops;
    ops.reserve(flat_operators.size());
    for (auto& op : flat_operators) {
        ops.push_back(op.Pack(builder, *this, dictionary));
    }
    auto flat_ops_ofs = builder.CreateVectorOfStructs(ops);
    auto flat_roots_ofs = builder.CreateVector(flat_root_operators);
    auto dictionary_strings = ChunkBuffer<std::string>::Flatten(std::move(dictionary.strings));
    auto string_dictionary_ofs = builder.CreateVectorOfStrings(dictionary_strings);

    buffers::view::PlanViewModelBuilder vm{builder};
    vm.add_string_dictionary(string_dictionary_ofs);
    vm.add_operators(flat_ops_ofs);
    vm.add_root_operators(flat_roots_ofs);

    return vm.Finish();
}

}  // namespace dashql
