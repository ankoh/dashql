#include "dashql/analyzer/program_instance.h"

#include <iomanip>
#include <sstream>
#include <stack>

#include "dashql/common/memstream.h"
#include "dashql/common/substring_buffer.h"
#include "dashql/common/variant.h"

namespace dashql {

// Constructor
ProgramInstance::ProgramInstance(std::shared_ptr<std::string> text, std::shared_ptr<sx::ProgramT> program,
                                 std::vector<ParameterValue> params)
    : program_text_(move(text)),
      program_(move(program)),
      parameter_values_(move(params)),
      evaluated_nodes_(program_->nodes.size()),
      node_errors_(),
      viz_statements_() {}

// Add a node error
void ProgramInstance::AddNodeError(NodeError&& error) { node_errors_.push_back(std::move(error)); }

// Find a parameter value
const ParameterValue* ProgramInstance::FindParameterValue(size_t stmt_id) const {
    // XXX check if valid
    return &parameter_values_[stmt_id];
}

// Find a parameter value
const ProgramInstance::NodeValue* ProgramInstance::FindNodeValue(size_t node_id) { return evaluated_nodes_.Find(node_id); }

// Collect the statement options
Expected<std::string> ProgramInstance::RenderStatementText(size_t stmt_id) const {
    auto& target_root = program_->nodes[program_->statements[stmt_id]->root_node];
    SubstringBuffer buffer{*program_text_, target_root.location()};

    // Replace all interpolated nodes
    evaluated_nodes_.IterateValues([&](size_t, const NodeValue& node_value) {
        // Intersects with buffer?
        auto& node = program_->nodes[node_value.root_node_id];
        auto node_loc = node.location();
        if (!buffer.Intersects(node_loc)) return;

        // Replace in buffer
        auto vstr = node_value.value.PrintValueAsScript();
        buffer.Replace(node_loc, vstr);
    });

    // Return the result
    return buffer.Finish();
}

/// Pack the evaluated nodes
flatbuffers::Offset<proto::analyzer::ProgramAnnotations> ProgramInstance::PackAnnotations(
    flatbuffers::FlatBufferBuilder& builder) const {
    // Pack parameters
    std::vector<flatbuffers::Offset<proto::analyzer::ParameterValue>> param_offsets;
    param_offsets.reserve(parameter_values_.size());
    for (auto& param : parameter_values_) {
        param_offsets.push_back(param.Pack(builder));
    }
    auto param_vec = builder.CreateVector(param_offsets);

    // Pack the evaluated nodes
    std::vector<flatbuffers::Offset<proto::analyzer::NodeValue>> eval_nodes;
    evaluated_nodes_.IterateValues([&](size_t /*node_id*/, const NodeValue& node_value) {
        auto vb = node_value.value.Pack(builder);
        proto::analyzer::NodeValueBuilder nv{builder};
        nv.add_node_id(node_value.root_node_id);
        nv.add_value(vb);
        eval_nodes.push_back(nv.Finish());
    });
    auto eval_node_vec = builder.CreateVector(eval_nodes);

    // Pack the viz statements
    std::vector<flatbuffers::Offset<proto::viz::VizSpec>> viz_specs;
    for (auto& viz : viz_statements_) {
        viz_specs.push_back(viz->Pack(builder));
    }
    auto viz_spec_vec = builder.CreateVector(viz_specs);

    // Encode the plan result
    proto::analyzer::ProgramAnnotationsBuilder annotations{builder};
    annotations.add_parameters(param_vec);
    annotations.add_evaluated_nodes(eval_node_vec);
    annotations.add_viz_specs(viz_spec_vec);
    // XXX node errors
    return annotations.Finish();
}

/// Find an attribute
const sx::Node* ProgramInstance::FindAttribute(const sx::Node& origin, sx::AttributeKey key) const {
    auto children_begin = origin.children_begin_or_value();
    auto children_count = origin.children_count();
    auto lb = children_begin;
    auto c = children_count;
    while (c > 0) {
        auto step = c / 2;
        auto iter = lb + step;
        auto& n = program_->nodes[iter];
        if (n.attribute_key() < key) {
            lb = iter + 1;
            c -= step + 1;
        } else {
            c = step;
        }
    }
    if (lb >= children_begin + children_count) {
        return nullptr;
    }
    auto& n = program_->nodes[lb];
    return (n.attribute_key() == key) ? &n : nullptr;
}

}  // namespace dashql
