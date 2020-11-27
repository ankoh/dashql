#include "dashql/program_instance.h"

namespace dashql {

/// Constructor
ProgramInstance::ProgramInstance(std::string_view text, const sx::ProgramT& program)
    : program_text_(text), program_(program), parameter_values_(), patch_() {}

/// Find a parameter value
const proto::session::ParameterValue* ProgramInstance::FindParameterValue(size_t stmt_id) const {
    if (auto iter = parameter_values_.find(stmt_id); iter != parameter_values_.end()) {
        return iter->second;
    }
    return nullptr;
}

//
//// Collect the statement options
//Expected<std::string> ActionPlanner::RenderStatementText(size_t stmt_id) {
//    // TODO Render the statement text
//    auto& next = next_program_.program();
//    auto& stmt = *next.statements[stmt_id];
//    auto& stmt_root = next.nodes[stmt.root];
//
//    // Find all the column refs that occur in the statement
//    for (auto& dep: next_program_.program().dependencies) {
//        if (dep.target_statement() != stmt_id || dep.type() != sx::DependencyType::COLUMN_REF) continue;
//        auto node_id = dep.target_node();
//        auto& node = next.nodes[node_id];
//        assert(node.node_type() == sx::NodeType::OBJECT_SQL_COLUMN_REF);
//
//        // Map to
//    }
//    return std::string{};
//}

Expected<std::string> ProgramInstance::RenderStatementText(size_t stmt_id) const {
    auto& stmt = *program_.statements[stmt_id];
    auto stmt_text = TextAt(program_.nodes[stmt.root].location());
    // XXX
    std::string copy{stmt_text.begin(), stmt_text.end()};
    return copy;
}

/// Find an attribute
const sx::Node* ProgramInstance::FindAttribute(const sx::Node& origin, sx::AttributeKey key) {
    auto children_begin = origin.children_begin_or_value();
    auto children_count = origin.children_count();
    auto lb = children_begin;
    auto c = children_count;
    while (c > 0) {
        auto step = c / 2;
        auto iter = lb + step;
        auto& n = program_.nodes[iter];
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
    auto& n = program_.nodes[lb];
    return (n.attribute_key() == key) ? &n : nullptr;
}

}  // dashql
