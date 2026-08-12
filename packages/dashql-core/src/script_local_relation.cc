#include "dashql/script_local_relation.h"

#include "dashql/utils/ast_attributes.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;

std::optional<TerminalPipeDefinition> FindTerminalPipeDefinition(const ParsedScript& parsed,
                                                                 uint32_t statement_id) {
    if (statement_id >= parsed.statements.size()) return std::nullopt;

    const auto& statement = parsed.statements[statement_id];
    const auto& ast = parsed.nodes;
    if (statement.root >= ast.size()) return std::nullopt;

    uint32_t query_node_id = statement.root;
    uint32_t pipe_node_id = statement.root;
    const auto* pipe = &ast[pipe_node_id];
    if (pipe->node_type() == NodeType::OBJECT_SQL_SELECT) {
        auto [expression] = LookupAttributes<AttributeKey::SQL_SELECT_EXPRESSION_STATEMENT>(
            std::span{ast}.subspan(pipe->children_begin_or_value(), pipe->children_count()));
        if (!expression) return std::nullopt;
        pipe_node_id = static_cast<uint32_t>(expression - ast.data());
        pipe = expression;
    }
    if (pipe->node_type() != NodeType::OBJECT_EXT_PIPE) return std::nullopt;

    auto [stages] = LookupAttributes<AttributeKey::EXT_PIPE_STAGES>(
        std::span{ast}.subspan(pipe->children_begin_or_value(), pipe->children_count()));
    if (!stages || stages->node_type() != NodeType::ARRAY || stages->children_count() == 0) {
        return std::nullopt;
    }

    auto body_stage_count = stages->children_count() - 1;
    const auto& final_stage = ast[stages->children_begin_or_value() + body_stage_count];
    if (final_stage.node_type() != NodeType::OBJECT_EXT_PIPE_AS) return std::nullopt;

    auto [alias] = LookupAttributes<AttributeKey::EXT_PIPE_ALIAS>(
        std::span{ast}.subspan(final_stage.children_begin_or_value(), final_stage.children_count()));
    if (!alias || alias->node_type() != NodeType::NAME) return std::nullopt;

    return TerminalPipeDefinition{
        .statement_id = statement_id,
        .query_node_id = query_node_id,
        .pipe_node_id = pipe_node_id,
        .alias_node_id = static_cast<uint32_t>(alias - ast.data()),
        .body_stage_count = body_stage_count,
    };
}

}  // namespace dashql
