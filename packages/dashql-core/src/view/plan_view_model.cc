#include "dashql/view/plan_view_model.h"

#include <sstream>
#include <string_view>

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/intrusive_list.h"

namespace dashql {

PlanViewModel::PlanViewModel() {}

void PlanViewModel::Reset() {
    pipelines.Clear();
    root_operators.clear();
    operators.clear();
    document = {};
    input_buffer.reset();
}

PlanViewModel::Pipeline& PlanViewModel::RegisterPipeline() {
    uint32_t pipeline_id = pipelines.GetSize();
    return pipelines.PushBack({.pipeline_id = pipeline_id, .edges = {}});
}

void PlanViewModel::FlattenOperators(ChunkBuffer<ParsedOperatorNode>&& parsed_ops,
                                     std::vector<std::reference_wrapper<ParsedOperatorNode>>&& parsed_roots) {
    // A DFS node
    struct OperatorDFSNode {
        /// The operator
        std::reference_wrapper<ParsedOperatorNode> op;
        /// Is visited
        bool visited;
    };

    // Prepare the operators
    std::vector<OperatorDFSNode> pending;
    for (auto iter = parsed_roots.rbegin(); iter != parsed_roots.rend(); ++iter) {
        pending.push_back({.op = *iter, .visited = false});
    }
    operators.reserve(parsed_ops.GetSize());

    // Run a post-order DFS over the parsed operator tree.
    // On our way up, write all children as block.
    std::unordered_map<const ParsedOperatorNode*, OperatorNode> mapped;
    while (!pending.empty()) {
        auto& current = pending.back();
        auto current_index = pending.size() - 1;
        auto& op = current.op.get();

        // Translate nodes in DFS post-order
        if (current.visited) {
            // Translate children
            auto& parsed_children = op.child_operators.CastUnsafeAs<ParsedOperatorNode>();
            size_t children_begin = operators.size();

            // Add child operators
            for (auto& child : parsed_children) {
                auto iter = mapped.find(&child);
                assert(iter != mapped.end());
                assert(operators.size() < operators.capacity());
                size_t operator_id = operators.size();
                operators.push_back(std::move(iter->second));
                operators.back().operator_id = operator_id;
                for (auto& child : operators.back().child_operators) {
                    child.parent_operator_id = operator_id;
                }
                mapped.erase(iter);
            }
            size_t child_count = operators.size() - children_begin;
            OperatorNode flat{std::move(op)};
            flat.child_operators = {operators.data() + children_begin, child_count};

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
    assert(mapped.size() == parsed_roots.size());
    root_operators.reserve(mapped.size());
    for (auto& [k, v] : mapped) {
        uint32_t oid = operators.size();
        operators.emplace_back(std::move(v));
        operators.back().operator_id = oid;
        root_operators.push_back(oid);
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

PlanViewModel::OperatorNode::OperatorNode(ParsedOperatorNode&& parsed)
    : operator_type(parsed.operator_type),
      operator_label(parsed.operator_label),
      source_location(parsed.source_location),
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

PlanViewModel::OperatorNode::OperatorNode(const OperatorNode& other) = default;

PlanViewModel::OperatorNode::OperatorNode(OperatorNode&& other) = default;

std::string PlanViewModel::OperatorNode::SerializeParentPath() const {
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

buffers::view::PlanOperator PlanViewModel::OperatorNode::Pack(flatbuffers::FlatBufferBuilder& builder,
                                                              const PlanViewModel& view_model,
                                                              StringDictionary& strings) const {
    buffers::view::PlanOperator op;
    op.mutate_operator_id(operator_id);
    if (operator_type.has_value()) {
        op.mutate_operator_type_name(strings.Allocate(operator_type.value()));
    } else {
        op.mutate_operator_type_name(std::numeric_limits<uint32_t>::max());
    }
    if (operator_label.has_value()) {
        op.mutate_operator_label(strings.Allocate(operator_label.value()));
    } else {
        op.mutate_operator_label(std::numeric_limits<uint32_t>::max());
    }
    op.mutate_parent_operator_id(parent_operator_id.value_or(std::numeric_limits<uint32_t>::max()));
    op.mutate_parent_path(strings.Allocate(SerializeParentPath()));
    if (source_location.has_value()) {
        auto& loc = op.mutable_source_location();
        loc.mutate_length(source_location->length());
        loc.mutate_offset(source_location->offset());
    }
    op.mutate_children_begin(child_operators.data() - view_model.operators.data());
    op.mutate_children_count(child_operators.size());
    if (layout_rect.has_value()) {
        op.mutable_layout_rect() = *layout_rect;
    }
    return op;
}

buffers::view::PlanOperatorEdge PlanViewModel::OperatorEdge::Pack(flatbuffers::FlatBufferBuilder& builder,
                                                                  const PlanViewModel& view_model,
                                                                  StringDictionary& strings) const {
    buffers::view::PlanOperatorEdge edge;
    edge.mutate_edge_id(edge_id);
    edge.mutate_parent_operator(parent_operator.operator_id);
    edge.mutate_parent_operator_port_count(parent_port_count);
    edge.mutate_parent_operator_port_index(parent_port_index);
    edge.mutate_child_operator(child_operator.operator_id);
    edge.mutate_pipeline_id(std::numeric_limits<uint32_t>::max());
    return edge;
}

flatbuffers::Offset<buffers::view::PlanViewModel> PlanViewModel::Pack(flatbuffers::FlatBufferBuilder& builder) const {
    // Track strings in a dictionary for flabuffer
    StringDictionary dictionary;

    // Pack plan fragments
    std::vector<buffers::view::PlanFragment> flat_fragments;
    flat_fragments.reserve(fragments.size());
    for (auto& f : fragments) {
        // XXX
        flat_fragments.emplace_back();
    }

    // Pack plan pipelines
    std::vector<buffers::view::PlanPipeline> flat_pipelines;
    flat_pipelines.reserve(pipelines.GetSize());
    pipelines.ForEach([&](size_t i, const Pipeline& p) {
        // XXX
        flat_pipelines.emplace_back();
    });

    // Pack plan operators
    std::vector<buffers::view::PlanOperator> flat_ops;
    flat_ops.reserve(operators.size());
    for (auto& op : operators) {
        flat_ops.push_back(op.Pack(builder, *this, dictionary));
    }

    // Pack the plan edges
    std::vector<buffers::view::PlanOperatorEdge> flat_op_edges;
    flat_op_edges.reserve(operator_edges.size());
    for (auto& edge : operator_edges) {
        flat_op_edges.push_back(edge.Pack(builder, *this, dictionary));
    }

    auto flat_fragments_ofs = builder.CreateVectorOfStructs(flat_fragments);
    auto flat_pipelines_ofs = builder.CreateVectorOfStructs(flat_pipelines);
    auto flat_ops_ofs = builder.CreateVectorOfStructs(flat_ops);
    auto flat_edges_ofs = builder.CreateVectorOfStructs(flat_op_edges);
    auto flat_roots_ofs = builder.CreateVector(root_operators);
    auto dictionary_strings = ChunkBuffer<std::string>::Flatten(std::move(dictionary.strings));
    auto string_dictionary_ofs = builder.CreateVectorOfStrings(dictionary_strings);

    buffers::view::PlanViewModelBuilder vm{builder};
    vm.add_layout_config(&layout_config);
    vm.add_string_dictionary(string_dictionary_ofs);
    vm.add_fragments(flat_fragments_ofs);
    vm.add_pipelines(flat_pipelines_ofs);
    vm.add_operators(flat_ops_ofs);
    vm.add_operator_edges(flat_edges_ofs);
    vm.add_root_operators(flat_roots_ofs);
    if (layout_rect.has_value()) {
        vm.add_layout_rect(&layout_rect.value());
    }

    return vm.Finish();
}

}  // namespace dashql
