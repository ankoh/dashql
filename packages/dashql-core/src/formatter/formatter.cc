#include "dashql/formatter/formatter.h"

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/ast_attributes.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;

/// Write a text
SerializingFormattingTarget& SerializingFormattingTarget::Write(std::string_view s, const FormattingConfig&) {
    current_line_width += s.size();
    return *this;
}
/// Write an indentation
SerializingFormattingTarget& SerializingFormattingTarget::Write(Indent i, const FormattingConfig& config) {
    current_line_width += i.level * config.indentation_width;
    return *this;
}
/// Write a line break
SerializingFormattingTarget& SerializingFormattingTarget::Write(LineBreakTag, const FormattingConfig&) {
    if (line_breaks == 0) {
        first_line_width = current_line_width;
    }
    current_line_width = 0;
    ++line_breaks;
    return *this;
}
/// Write a line break
SerializingFormattingTarget& SerializingFormattingTarget::Write(SerializingFormattingTarget&& other,
                                                                const FormattingConfig&) {
    if (other.line_breaks == 0) {
        current_line_width += other.current_line_width;
    } else {
        current_line_width = other.current_line_width;
        line_breaks = 0;
    }
    current_line_width = 0;
    ++line_breaks;
    return *this;
}

Formatter::Formatter(std::shared_ptr<ParsedScript> parsed)
    : scanned(*parsed->scanned_script), parsed(*parsed), ast(parsed->GetNodes()), config() {
    node_states.resize(ast.size());
}

template <FormattingTarget Target>
void formatCommaSeparated(Formatter::FormattingMode mode, Target& out, std::span<Formatter::NodeState> states,
                          Indent& indent, const FormattingConfig& config) {
    for (size_t i = 0; i < states.size(); ++i) {
        switch (mode) {
            case Formatter::FormattingMode::Inline: {
                if (i > 0) {
                    out.Write(", ", config);
                }
                out.Write(std::move(states[i].Get<Target>()), config);
                break;
            }
            case Formatter::FormattingMode::Compact: {
                if (i > 0) {
                    out.Write(",", config);
                    if (out.GetCurrentLineWidth() >= config.max_width) {
                        out.Write(LineBreak, config);
                        out.Write(indent, config);
                    } else {
                        out.Write(" ", config);
                    }
                    out.Write(std::move(states[i].Get<Target>()), config);
                }
                break;
            }
            case Formatter::FormattingMode::Pretty: {
                if (i > 0) {
                    out.Write(",", config);
                    out.Write(LineBreak, config);
                    out.Write(indent, config);
                }
                out.Write(std::move(states[i].Get<Target>()), config);
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

            out.Write("select", config);
            if (select_targets && select_targets->node_type() == NodeType::ARRAY) {
                out.Write(" ", config);
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
                out.Write(std::move(GetNodeState(*target_value).Get<Target>()), config);
            }
            break;
        }
        case NodeType::LITERAL_INTEGER:
            out.Write(scanned.ReadTextAtLocation(node.location()), config);
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
        formatNode<SimulatedFormattingTarget>(node_id, FormattingMode::Inline);
    }
    // Formatting phase
    for (size_t i = 0; i < ast.size(); ++i) {
        size_t node_id = i;
        formatNode<SerializingFormattingTarget>(node_id, FormattingMode::Compact);
    }

    rope::Rope dummy{128};
    return dummy;
}

}  // namespace dashql
