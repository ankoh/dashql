#include "dashql/formatter/formatter.h"

#include <functional>

#include "dashql/buffers/index_generated.h"
#include "dashql/formatter/formatting_target.h"
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
void formatCommaSeparated(Target& out, Formatter::FormattingStrategy strategy, std::span<Formatter::NodeState> states,
                          Indent& indent, const FormattingConfig& config) {
    switch (strategy) {
        // a, b, c, d
        case Formatter::FormattingStrategy::Inline:
            for (size_t i = 0; i < states.size(); ++i) {
                if (i > 0) {
                    out << ", ";
                }
                out << states[i].Get<Target>();
            }
            break;

        // a, b,
        // c, d
        case Formatter::FormattingStrategy::Compact:
            for (size_t i = 0; i < states.size(); ++i) {
                if (i > 0) {
                    auto& next = states[i].Get<SimulatedInlineFormatter>();
                    if ((out.GetLineWidth() + 2 + next.GetLineWidth()) > config.max_width) {
                        out << "," << LineBreak << indent;
                    } else {
                        out << ", ";
                    }
                }
                out << states[i].Get<Target>();
            }
            break;

        // a,
        // b,
        // c,
        // d
        case Formatter::FormattingStrategy::Vertical:
            for (size_t i = 0; i < states.size(); ++i) {
                if (i > 0) {
                    out << "," << LineBreak << indent;
                }
                out << states[i].Get<Target>();
            }
            break;
    }
}

// Helper to format an operator separated list
template <FormattingTarget Target>
void formatOperatorSeparated(Target& out, Formatter::FormattingStrategy strategy, std::string_view op,
                             std::span<Formatter::NodeState> states, Indent& indent, const FormattingConfig& config) {
    switch (strategy) {
        // a AND b AND c AND d
        case Formatter::FormattingStrategy::Inline:
            for (size_t i = 0; i < states.size(); ++i) {
                if (i > 0) {
                    out << " " << op << " ";
                }
                out << states[i].Get<Target>();
            }
            break;

        // a AND b AND
        // c AND d
        case Formatter::FormattingStrategy::Compact:
            for (size_t i = 0; i < states.size(); ++i) {
                if (i > 0) {
                    auto& inlined = states[i].Get<SimulatedInlineFormatter>();
                    if ((out.GetLineWidth() + op.size() + 2 + inlined.GetLineWidth()) > config.max_width) {
                        out << op << LineBreak << indent;
                    } else {
                        out << " " << op << " ";
                    }
                }
                out << states[i].Get<Target>();
            }
            break;

        // a
        // AND b
        // AND c
        // AND d
        case Formatter::FormattingStrategy::Vertical:
            for (size_t i = 0; i < states.size(); ++i) {
                if (i > 0) {
                    out << op << LineBreak << indent;
                }
                out << states[i].Get<Target>();
            }
            break;
    }
}

template <FormattingTarget Out> void Formatter::formatNode(size_t node_id, FormattingStrategy mode) {
    const buffers::parser::Node& node = ast[node_id];
    NodeState& state = node_states[node_id];
    Out& out = state.Get<Out>();

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
                formatCommaSeparated(out, mode, children, state.output_indentation, config);
            }
            break;
        }
        case NodeType::OBJECT_SQL_RESULT_TARGET: {
            auto [target_value, target_name, target_star] =
                GetNodeAttributes<AttributeKey::SQL_RESULT_TARGET_VALUE, AttributeKey::SQL_RESULT_TARGET_NAME,
                                  AttributeKey::SQL_RESULT_TARGET_STAR>(node);

            if (target_value) {
                out << GetNodeState(*target_value).Get<Out>();
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

size_t Formatter::EstimateFormattedSize() const {
    size_t input_length = scanned.GetInput().size();
    size_t prev_statement_length = 0;
    size_t new_statement_length = 0;

    for (auto& statement : parsed.statements) {
        prev_statement_length += ast[statement.root].location().length();
    }
    for (auto& node_state : node_states) {
        new_statement_length += node_state.output.own_characters;
    }
    assert(input_length >= prev_statement_length);
    return input_length - prev_statement_length + new_statement_length + 2 /* Padding */;
}

std::string Formatter::Format(const FormattingConfig& config) {
    // Measuring phase
    for (size_t i = 0; i < ast.size(); ++i) {
        size_t node_id = i;
        formatNode<SimulatedInlineFormatter>(node_id, FormattingStrategy::Inline);
    }
    // Formatting phase
    for (size_t i = 0; i < ast.size(); ++i) {
        size_t node_id = i;
        formatNode<FormattingBuffer>(node_id, FormattingStrategy::Compact);
    }

    // Collect the replacements
    using Replacement = std::pair<buffers::parser::Location, std::reference_wrapper<NodeState>>;
    std::vector<Replacement> replacements;
    for (auto& statement : parsed.statements) {
        replacements.emplace_back(ast[statement.root].location(), node_states[statement.root]);
    }
    std::ranges::sort(replacements, std::less<>{}, [&](const Replacement& r) { return std::get<0>(r).offset(); });

    // Prepare the output buffer
    std::string_view input = scanned.GetInput();
    input = input.substr(0, std::max<size_t>(input.size(), 2) - 2);
    std::string output_buffer;
    size_t estimated_output_size = EstimateFormattedSize();
    output_buffer.reserve(estimated_output_size);

    // Copy the text
    ssize_t reader = 0;
    for (auto& [loc, node] : replacements) {
        output_buffer += input.substr(reader, std::max<size_t>(loc.offset(), reader) - reader);
        node.get().FormatText(output_buffer);
        reader = loc.offset() + loc.length();
    }
    output_buffer += input.substr(reader, input.size() - reader);
    return output_buffer;
}

}  // namespace dashql
