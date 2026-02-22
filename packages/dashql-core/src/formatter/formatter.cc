#include "dashql/formatter/formatter.h"

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/ast_attributes.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;

Formatter::Formatter(std::shared_ptr<ParsedScript> parsed)
    : scanned(*parsed->scanned_script), parsed(*parsed), ast(parsed->GetNodes()), config() {
    node_states.resize(ast.size());
}

/// Helper to format a comma separated list
template <FormattingTarget Target>
void formatCommaSeparated(Formatter::FormattingMode mode, Target& out, std::span<Formatter::NodeState> states,
                          Indent& indent, const FormattingConfig& config) {
    for (size_t i = 0; i < states.size(); ++i) {
        switch (mode) {
            case Formatter::FormattingMode::Inline: {
                if (i > 0) {
                    out << ", ";
                }
                out << states[i].Get<Target>();
                break;
            }
            case Formatter::FormattingMode::Compact: {
                if (i > 0) {
                    out << ",";
                    if (out.GetCurrentLineWidth() >= config.max_width) {
                        out << LineBreak;
                        out << indent;
                    } else {
                        out << " ";
                    }
                    out << states[i].Get<Target>();
                }
                break;
            }
            case Formatter::FormattingMode::Pretty: {
                if (i > 0) {
                    out << ",";
                    out << LineBreak;
                    out << indent;
                }
                out << states[i].Get<Target>();
                break;
            }
        }
    }
}

template <FormattingTarget Target> void Formatter::formatNode(size_t node_id, FormattingMode mode) {
    const buffers::parser::Node& node = ast[node_id];
    NodeState& state = node_states[node_id];
    Target& out = state.Get<Target>();

    switch (node.node_type()) {
        case NodeType::OBJECT_SQL_SELECT: {
            auto [select_all, select_targets, select_into, select_from, select_where, select_groups, select_having,
                  select_windows, select_order, select_row_locking, select_with_ctes, select_with_recursive,
                  select_offset, select_limit, select_limit_all, select_sample, select_values] =
                GetNodeAttributes<
                    AttributeKey::SQL_SELECT_ALL, AttributeKey::SQL_SELECT_TARGETS, AttributeKey::SQL_SELECT_INTO,
                    AttributeKey::SQL_SELECT_FROM, AttributeKey::SQL_SELECT_WHERE, AttributeKey::SQL_SELECT_GROUPS,
                    AttributeKey::SQL_SELECT_HAVING, AttributeKey::SQL_SELECT_WINDOWS, AttributeKey::SQL_SELECT_ORDER,
                    AttributeKey::SQL_SELECT_ROW_LOCKING, AttributeKey::SQL_SELECT_WITH_CTES,
                    AttributeKey::SQL_SELECT_WITH_RECURSIVE, AttributeKey::SQL_SELECT_OFFSET,
                    AttributeKey::SQL_SELECT_LIMIT, AttributeKey::SQL_SELECT_LIMIT_ALL, AttributeKey::SQL_SELECT_SAMPLE,
                    AttributeKey::SQL_SELECT_VALUES>(node);

            out << "select";
            if (select_targets && select_targets->node_type() == NodeType::ARRAY) {
                out << " ";
                auto children = GetArrayStates(*select_targets);
                formatCommaSeparated(mode, out, children, state.indentation, config);
            }
            break;
        }
        case NodeType::OBJECT_SQL_RESULT_TARGET: {
            auto [target_value, target_name, target_star] =
                LookupAttributes<AttributeKey::SQL_RESULT_TARGET_VALUE, AttributeKey::SQL_RESULT_TARGET_NAME,
                                 AttributeKey::SQL_RESULT_TARGET_STAR>(ast);

            if (target_value) {
                out << GetNodeState(*target_value).Get<Target>();
            }
            break;
        }
        case NodeType::LITERAL_INTEGER:
            out << scanned.ReadTextAtLocation(node.location());
            break;
        default:
            break;
    }
}

rope::Rope Formatter::Format(const FormattingConfig& config) {
    // Preparation phase
    for (size_t i = 0; i < ast.size(); ++i) {
    }
    // Measuring phase
    for (size_t i = 0; i < ast.size(); ++i) {
        size_t node_id = i;
        formatNode<SimulatedFormattingBuffer>(node_id, FormattingMode::Inline);
    }
    // Formatting phase
    for (size_t i = 0; i < ast.size(); ++i) {
        size_t node_id = i;
        formatNode<FormattingBuffer>(node_id, FormattingMode::Compact);
    }

    rope::Rope dummy{128};
    return dummy;
}

}  // namespace dashql
