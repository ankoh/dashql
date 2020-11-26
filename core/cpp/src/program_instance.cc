#include "dashql/program_instance.h"

namespace dashql {

/// Constructor
ProgramInstance::ProgramInstance(std::string_view text, const sx::ProgramT& program)
    : program_text_(text), program_(program), parameters_(), patch_() {}

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

}  // dashql
