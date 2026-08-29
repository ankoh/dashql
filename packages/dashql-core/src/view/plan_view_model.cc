#include "dashql/view/plan_view_model.h"

#include <sstream>
#include <string_view>

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/intrusive_list.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

namespace dashql {

PlanViewModel::PlanViewModel() {}

void PlanViewModel::Reset() {
    pipelines.Clear();
    fragments.clear();
    root_operators.clear();
    operators.clear();
    operator_edges.clear();
    operator_cross_edges.clear();
    layout_rect.reset();
    document = {};
    input_buffer.reset();
}

void PlanViewModel::ResetExecution() {
    // XXX
}

PlanViewModel::Pipeline& PlanViewModel::RegisterPipeline(std::optional<uint64_t> source_pipeline_id) {
    uint32_t pipeline_id = pipelines.GetSize();
    return pipelines.PushBack({.pipeline_id = pipeline_id, .source_pipeline_id = source_pipeline_id});
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
                for (size_t i = 0; i < operators.back().children_count; ++i) {
                    operators[operators.back().children_begin + i].parent_operator_id = operator_id;
                }
                mapped.erase(iter);
            }
            size_t child_count = operators.size() - children_begin;
            OperatorNode flat{std::move(op)};
            flat.children_begin = children_begin;
            flat.children_count = child_count;

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
        for (size_t i = 0; i < operators.back().children_count; ++i) {
            operators[operators.back().children_begin + i].parent_operator_id = oid;
        }
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
      source_operator_id(parsed.source_operator_id),
      parent_path(std::move(parsed.parent_child_path)),
      source_location(parsed.source_location),
      source_value(std::move(parsed.source_value)),
      operator_attributes(std::move(parsed.operator_attributes)) {};

PlanViewModel::OperatorNode::OperatorNode(const OperatorNode& other) = default;

PlanViewModel::OperatorNode::OperatorNode(OperatorNode&& other)
    : operator_id(other.operator_id),
      operator_type(other.operator_type),
      operator_label(other.operator_label),
      source_operator_id(other.source_operator_id),
      parent_operator_id(other.parent_operator_id),
      parent_path(std::move(other.parent_path)),
      source_location(other.source_location),
      source_value(std::move(other.source_value)),
      children_begin(other.children_begin),
      children_count(other.children_count),
      child_edges(other.child_edges),
      cross_edges_begin(other.cross_edges_begin),
      cross_edge_count(other.cross_edge_count),
      layout_rect(other.layout_rect),
      operator_attributes(std::move(other.operator_attributes)) {}

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

namespace {

bool ContainsOperator(const rapidjson::Value& value) {
    if (value.IsObject()) {
        auto object = value.GetObject();
        auto op = object.FindMember("operator");
        if (op != object.MemberEnd() && op->value.IsString()) return true;
        for (auto iter = object.MemberBegin(); iter != object.MemberEnd(); ++iter) {
            if (ContainsOperator(iter->value)) return true;
        }
    } else if (value.IsArray()) {
        for (auto& entry : value.GetArray()) {
            if (ContainsOperator(entry)) return true;
        }
    }
    return false;
}

std::string SerializeJSON(const rapidjson::Value& value) {
    rapidjson::StringBuffer buffer;
    rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
    value.Accept(writer);
    return {buffer.GetString(), buffer.GetSize()};
}

const rapidjson::Value* FindMember(const rapidjson::Value& value,
                                   std::initializer_list<std::string_view> names) {
    if (!value.IsObject()) return nullptr;
    auto object = value.GetObject();
    for (auto name : names) {
        auto member = object.FindMember(rapidjson::StringRef(name.data(), name.size()));
        if (member != object.MemberEnd()) return &member->value;
    }
    return nullptr;
}

const rapidjson::Value* FindNumber(const rapidjson::Value& value,
                                   std::initializer_list<std::string_view> names) {
    const auto* member = FindMember(value, names);
    return member != nullptr && member->IsNumber() ? member : nullptr;
}

void ReadExecutionStatistics(const rapidjson::Value& source, buffers::view::PlanExecutionStatistics& out) {
    const rapidjson::Value* statistics = FindMember(source, {"statistics"});
    const rapidjson::Value& runtime = statistics != nullptr && statistics->IsObject() ? *statistics : source;

    const rapidjson::Value* input_estimated =
        FindNumber(source, {"estimated-rows-in-table", "estimatedRowsInTable"});
    if (input_estimated == nullptr) {
        input_estimated = FindNumber(runtime, {"estimated-rows-in-table", "estimatedRowsInTable"});
    }
    if (input_estimated != nullptr) out.mutate_input_cardinality_estimated(input_estimated->GetDouble());

    const rapidjson::Value* output_estimated = FindNumber(source, {"estimated-rows", "estimatedRows", "cardinality"});
    if (output_estimated == nullptr) {
        output_estimated = FindNumber(runtime, {"estimated-rows", "estimatedRows", "cardinality"});
    }
    if (output_estimated != nullptr) out.mutate_output_cardinality_estimated(output_estimated->GetDouble());

    if (const auto* input_consumed = FindNumber(runtime, {"processed-rows", "processedRows"})) {
        out.mutate_input_cardinality_consumed(input_consumed->GetUint64());
    }
    if (const auto* output_produced = FindNumber(runtime, {"output-rows", "outputRows"})) {
        out.mutate_output_cardinality_produced(output_produced->GetUint64());
    }
    if (const auto* memory_bytes = FindNumber(runtime, {"memory-bytes", "memoryBytes"})) {
        out.mutate_memory_bytes(memory_bytes->GetUint64());
    }
}

}  // namespace

buffers::view::PlanOperator PlanViewModel::OperatorNode::Pack(
    flatbuffers::FlatBufferBuilder& builder, const PlanViewModel& view_model, StringDictionary& strings,
    std::vector<buffers::view::PlanAttribute>& attributes) const {
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
    op.mutate_children_begin(children_begin);
    op.mutate_children_count(children_count);
    op.mutate_cross_edges_begin(cross_edges_begin);
    op.mutate_cross_edge_count(cross_edge_count);
    op.mutate_attributes_begin(attributes.size());
    if (std::holds_alternative<std::reference_wrapper<rapidjson::Value>>(source_value)) {
        const auto& source = std::get<std::reference_wrapper<rapidjson::Value>>(source_value).get();
        if (source.IsObject()) {
            for (auto iter = source.MemberBegin(); iter != source.MemberEnd(); ++iter) {
                if (ContainsOperator(iter->value)) continue;
                buffers::view::PlanAttribute attribute;
                attribute.mutate_attribute_id(attributes.size());
                attribute.mutate_name(strings.Allocate(std::string_view{iter->name.GetString()}));
                attribute.mutate_value_json(strings.Allocate(SerializeJSON(iter->value)));
                attributes.push_back(attribute);
            }
        }
    }
    op.mutate_attribute_count(attributes.size() - op.attributes_begin());
    if (std::holds_alternative<std::reference_wrapper<rapidjson::Value>>(source_value)) {
        ReadExecutionStatistics(std::get<std::reference_wrapper<rapidjson::Value>>(source_value).get(),
                                op.mutable_execution_statistics());
    }
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
    std::vector<uint32_t> flat_fragment_operators;
    flat_fragments.reserve(fragments.size());
    for (const auto& f : fragments) {
        size_t operators_begin = flat_fragment_operators.size();
        flat_fragment_operators.insert(flat_fragment_operators.end(), f.operators.begin(), f.operators.end());
        auto& fragment = flat_fragments.emplace_back();
        fragment.mutate_fragment_id(f.fragment_id);
        fragment.mutate_anchor_operator(f.anchor_operator);
        fragment.mutate_operators_begin(operators_begin);
        fragment.mutate_operator_count(flat_fragment_operators.size() - operators_begin);
    }

    // Pack plan pipelines
    std::vector<buffers::view::PlanPipeline> flat_pipelines;
    std::vector<buffers::view::PlanPipelineEdge> flat_pipeline_edges;
    std::vector<uint32_t> flat_pipeline_operators;
    {
        size_t edge_count = 0;
        size_t operator_count = 0;
        pipelines.ForEach([&](size_t i, const Pipeline& p) {
            edge_count += p.edges.size();
            operator_count += p.operators.size();
        });
        flat_pipeline_edges.reserve(edge_count);
        flat_pipeline_operators.reserve(operator_count);
    }
    flat_pipelines.reserve(pipelines.GetSize());
    pipelines.ForEach([&](size_t i, const Pipeline& p) {
        size_t edges_begin = flat_pipeline_edges.size();
        flat_pipeline_edges.insert(flat_pipeline_edges.end(), p.edges.begin(), p.edges.end());
        size_t operators_begin = flat_pipeline_operators.size();
        flat_pipeline_operators.insert(flat_pipeline_operators.end(), p.operators.begin(), p.operators.end());
        size_t pipeline_id = flat_pipelines.size();
        auto& pipeline = flat_pipelines.emplace_back();
        pipeline.mutate_pipeline_id(pipeline_id);
        pipeline.mutate_edges_begin(edges_begin);
        pipeline.mutate_edge_count(flat_pipeline_edges.size() - edges_begin);
        pipeline.mutate_operators_begin(operators_begin);
        pipeline.mutate_operator_count(flat_pipeline_operators.size() - operators_begin);
    });

    // Pack plan operators
    std::vector<buffers::view::PlanOperator> flat_ops;
    std::vector<buffers::view::PlanAttribute> flat_attributes;
    flat_ops.reserve(operators.size());
    for (auto& op : operators) {
        flat_ops.push_back(op.Pack(builder, *this, dictionary, flat_attributes));
    }

    // Pack the plan edges
    std::vector<buffers::view::PlanOperatorEdge> flat_op_edges;
    flat_op_edges.reserve(operator_edges.size());
    for (auto& edge : operator_edges) {
        flat_op_edges.push_back(edge.Pack(builder, *this, dictionary));
    }

    // Pack the plan cross edges and their relationship metadata.
    std::vector<buffers::view::PlanOperatorCrossEdge> flat_cross_edges;
    flat_cross_edges.reserve(operator_cross_edges.size());
    for (const auto& edge : operator_cross_edges) {
        buffers::view::PlanOperatorCrossEdge flat;
        flat.mutate_edge_id(edge.edge_id);
        flat.mutate_source_node(edge.source_node);
        flat.mutate_target_node(edge.target_node);
        flat.mutate_pipeline_id(std::numeric_limits<uint32_t>::max());
        flat.mutate_attributes_begin(flat_attributes.size());

        buffers::view::PlanAttribute kind;
        kind.mutate_attribute_id(flat_attributes.size());
        kind.mutate_name(dictionary.Allocate(std::string_view{"kind"}));
        kind.mutate_value_json(dictionary.Allocate(std::string{"\""} + std::string{edge.kind} + "\""));
        flat_attributes.push_back(kind);
        for (const auto& [name, value_json] : edge.attributes) {
            buffers::view::PlanAttribute attribute;
            attribute.mutate_attribute_id(flat_attributes.size());
            attribute.mutate_name(dictionary.Allocate(name));
            attribute.mutate_value_json(dictionary.Allocate(std::string_view{value_json}));
            flat_attributes.push_back(attribute);
        }
        flat.mutate_attribute_count(flat_attributes.size() - flat.attributes_begin());
        flat_cross_edges.push_back(flat);
    }

    auto flat_fragments_ofs = builder.CreateVectorOfStructs(flat_fragments);
    auto flat_fragment_operators_ofs = builder.CreateVector(flat_fragment_operators);
    auto flat_pipelines_ofs = builder.CreateVectorOfStructs(flat_pipelines);
    auto flat_pipeline_edges_ofs = builder.CreateVectorOfStructs(flat_pipeline_edges);
    auto flat_pipeline_operators_ofs = builder.CreateVector(flat_pipeline_operators);
    auto flat_ops_ofs = builder.CreateVectorOfStructs(flat_ops);
    auto flat_attributes_ofs = builder.CreateVectorOfStructs(flat_attributes);
    auto flat_edges_ofs = builder.CreateVectorOfStructs(flat_op_edges);
    auto flat_cross_edges_ofs = builder.CreateVectorOfStructs(flat_cross_edges);
    auto flat_roots_ofs = builder.CreateVector(root_operators);
    auto dictionary_strings = ChunkBuffer<std::string>::Flatten(std::move(dictionary.strings));
    auto string_dictionary_ofs = builder.CreateVectorOfStrings(dictionary_strings);

    buffers::view::PlanViewModelBuilder vm{builder};
    vm.add_layout_config(&layout_config);
    vm.add_string_dictionary(string_dictionary_ofs);
    vm.add_fragments(flat_fragments_ofs);
    vm.add_fragment_operators(flat_fragment_operators_ofs);
    vm.add_pipelines(flat_pipelines_ofs);
    vm.add_pipeline_edges(flat_pipeline_edges_ofs);
    vm.add_pipeline_operators(flat_pipeline_operators_ofs);
    vm.add_operators(flat_ops_ofs);
    vm.add_attributes(flat_attributes_ofs);
    vm.add_operator_edges(flat_edges_ofs);
    vm.add_operator_cross_edges(flat_cross_edges_ofs);
    vm.add_root_operators(flat_roots_ofs);
    if (layout_rect.has_value()) {
        vm.add_layout_rect(&layout_rect.value());
    }

    return vm.Finish();
}

}  // namespace dashql
