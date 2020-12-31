#include "dashql/analyzer/program_instance.h"
#include "dashql/common/variant.h"
#include "dashql/common/memstream.h"

#include <iomanip>
#include <sstream>
#include <stack>

#include "dashql/common/substring_buffer.h"

namespace dashql {

/// Constructor
ProgramInstance::ProgramInstance(std::shared_ptr<std::string> text, std::shared_ptr<sx::ProgramT> program, std::vector<ParameterValue> params)
    : program_text_(move(text)), program_(move(program)), parameter_values_(move(params)), evaluated_nodes_(program_->nodes.size()) {
}

/// Find a parameter value
const ProgramInstance::ParameterValue* ProgramInstance::FindParameterValue(size_t stmt_id) const {
    // XXX check if valid
    return &parameter_values_[stmt_id];
}

// Collect the statement options
Expected<std::string> ProgramInstance::RenderStatementText(size_t stmt_id) const {
    auto& target_root = program_->nodes[program_->statements[stmt_id]->root_node];
    SubstringBuffer buffer{*program_text_, target_root.location()};

    // Replace all interpolated nodes
    evaluated_nodes_.IterateValues([&](size_t, const EvaluatedNode& eval) {
        auto& [node_id, value] = eval;
        if (!value) return;

        // Intersects with buffer?
        auto& node = program_->nodes[node_id];
        auto node_loc = node.location();
        if (!buffer.Intersects(node_loc)) return;

        // Replace in buffer
        auto vstr = value->PrintValue();
        buffer.Replace(node_loc, vstr);
    });

    // Return the result
    return buffer.Finish();
}

/// Build the patch
flatbuffers::Offset<sx::ProgramPatch> ProgramInstance::PackProgramPatch(flatbuffers::FlatBufferBuilder& builder) const {
    sx::ProgramPatchBuilder patch{builder};
    /// XXX
    return patch.Finish();
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
