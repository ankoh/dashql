#include "dashql/formatter/formatter.h"

#include <functional>

#include "dashql/buffers/index_generated.h"
#include "dashql/formatter/formatting_target.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;

Formatter::Formatter(std::shared_ptr<ParsedScript> parsed)
    : scanned(*parsed->scanned_script), parsed(*parsed), ast(parsed->GetNodes()), config() {
    node_states.resize(ast.size());
}

template <FormattingTarget Target> constexpr bool WouldOverflow(Target& out, const FormattingConfig& config, size_t n) {
    if (auto w = out.GetLineWidth(); w.has_value()) {
        return (*w + n) > config.max_width;
    } else {
        // Treat as overflowing if we don't know
        return true;
    }
}
template <FormattingTarget Target>
constexpr bool BreakOnOverflow(Target& out, const Indent& indent, const FormattingConfig& config,
                               size_t inline_node_width) {
    if (WouldOverflow(out, config, 1 + inline_node_width)) {
        out << LineBreak << indent;
        return true;
    } else {
        out << " ";
        return false;
    }
}

/// Render a node inline
template <FormattingTarget Target>
constexpr Target& Inline(Formatter::NodeState& state, const Indent& indent, std::optional<size_t> offset) {
    Target& out = state.Get<Target>();
    out.Configure(FormattingMode::Inline, indent, offset);
    return out;
}

/// Render a node compact
template <FormattingTarget Target>
constexpr Target& Compact(Formatter::NodeState& state, const Indent& indent, std::optional<size_t> offset) {
    Target& out = state.Get<Target>();
    out.Configure(FormattingMode::Compact, indent, offset);
    return out;
}

/// Render a node pretty
template <FormattingTarget Target>
constexpr Target& Pretty(Formatter::NodeState& state, const Indent& indent, std::optional<size_t> offset) {
    Target& out = state.Get<Target>();
    out.Configure(FormattingMode::Pretty, indent, offset);
    return out;
}

/// Helper to format a comma separated list
template <FormattingMode mode, FormattingTarget Target>
constexpr void formatCommaSeparated(Target& out, const Indent& indent, const FormattingConfig& config,
                                    std::span<Formatter::NodeState> children) {
    switch (mode) {
        // a, b, c, d
        case FormattingMode::Inline:
            for (size_t i = 0; i < children.size(); ++i) {
                if (i > 0) {
                    out << ", ";
                }
                out << Inline<Target>(children[i], indent, out.GetLineWidth());
            }
            break;

        // a, b,
        // c, d
        case FormattingMode::Compact:
            for (size_t i = 0; i < children.size(); ++i) {
                auto& child = children[i].Get<SimulatedInlineFormatter>();
                if (i > 0) {
                    if (auto w = out.GetLineWidth();
                        w.has_value() && ((*w + 2 + *child.GetLineWidth()) > config.max_width)) {
                        out << "," << LineBreak << out.GetIndent();
                        assert(out.GetLineWidth().has_value());

                    } else {
                        out << ", ";
                    }
                }
                // Prefer rendering the first element inline
                if ((*out.GetLineWidth() + *child.GetLineWidth()) <= config.max_width) {
                    out << Inline<Target>(children[i], indent, out.GetLineWidth());
                } else {
                    out << Compact<Target>(children[i], indent, out.GetLineWidth());
                }
            }
            break;

        // a,
        // b,
        // c,
        // d
        case FormattingMode::Pretty:
            for (size_t i = 0; i < children.size(); ++i) {
                if (i > 0) {
                    out << "," << LineBreak << out.GetIndent();
                }
                out << Pretty<Target>(children[i], indent, out.GetLineWidth());
            }
            break;
    }
}

// Helper to format an operator separated list
template <FormattingMode mode, FormattingTarget Target>
constexpr void formatOperatorSeparated(Target& out, const Indent& indent, const FormattingConfig& config,
                                       std::span<Formatter::NodeState> children, std::string_view op) {
    switch (mode) {
        // a AND b AND c AND d
        case FormattingMode::Inline:
            for (size_t i = 0; i < children.size(); ++i) {
                if (i > 0) {
                    out << " " << op << " ";
                }
                out << Inline<Target>(children[i], indent, out.GetLineWidth());
            }
            break;

        // a AND b AND
        // c AND d
        case FormattingMode::Compact:
            for (size_t i = 0; i < children.size(); ++i) {
                auto& child = children[i].Get<SimulatedInlineFormatter>();
                if (i > 0) {
                    if (auto w = out.GetLineWidth();
                        w.has_value() && ((*w + 2 + op.size() + *child.GetLineWidth()) > config.max_width)) {
                        out << op << LineBreak << indent;
                        assert(out.GetLineWidth().has_value());

                    } else {
                        out << " " << op << " ";
                    }
                }
                // Prefer rendering the first element inline
                if ((*out.GetLineWidth() + *child.GetLineWidth()) <= config.max_width) {
                    out << Inline<Target>(children[i], indent, out.GetLineWidth());
                } else {
                    out << Compact<Target>(children[i], indent, out.GetLineWidth());
                }
            }
            break;

        // a
        // AND b
        // AND c
        // AND d
        case FormattingMode::Pretty:
            for (size_t i = 0; i < children.size(); ++i) {
                if (i > 0) {
                    out << op << LineBreak << indent;
                }
                out << Pretty<Target>(children[i], indent, out.GetLineWidth());
            }
            break;
    }
}

template <FormattingMode mode, FormattingTarget Out> void Formatter::formatNode(size_t node_id) {
    const buffers::parser::Node& node = ast[node_id];
    NodeState& state = node_states[node_id];
    Out& out = state.Get<Out>();

    switch (node.node_type()) {
        case NodeType::ARRAY: {
            switch (node.attribute_key()) {
                case AttributeKey::SQL_SELECT_TARGETS:
                    formatCommaSeparated<mode>(out, out.GetIndent(), config, GetArrayStates(node));
                    break;
                default:
                    break;
            }
            break;
        }
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
                switch (mode) {
                    case FormattingMode::Inline:
                        out << " ";
                        out << Inline<Out>(GetNodeState(*select_targets), out.GetIndent(), out.GetLineWidth());
                        break;
                    case FormattingMode::Compact:
                        out << " ";
                        out << Compact<Out>(GetNodeState(*select_targets), out.GetIndent() + 1, out.GetLineWidth());
                        break;
                    case FormattingMode::Pretty:
                        BreakOnOverflow(out, out.GetIndent() + 1, config, GetInlineNodeWidth(*select_targets));
                        out << Pretty<Out>(GetNodeState(*select_targets), out.GetIndent() + 1, out.GetLineWidth());
                        break;
                }
            }
            if (select_from && select_from->node_type() == NodeType::ARRAY) {
                switch (mode) {
                    case FormattingMode::Inline:
                        out << " from ";
                        break;
                    case FormattingMode::Compact:
                        out << LineBreak << out.GetIndent();
                        out << "from";
                        break;
                    case FormattingMode::Pretty:
                        out << LineBreak << out.GetIndent();
                        out << "from";
                        BreakOnOverflow(out, out.GetIndent() + 1, config, GetInlineNodeWidth(*select_from));
                        break;
                }
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
        new_statement_length += node_state.out.contributed_chars;
    }
    assert(input_length >= prev_statement_length);
    return input_length - prev_statement_length + new_statement_length + 2 /* Padding */;
}

std::string Formatter::Format(const FormattingConfig& config) {
    // Simulate inline formatting
    for (size_t i = 0; i < ast.size(); ++i) {
        size_t node_id = i;
        formatNode<FormattingMode::Inline, SimulatedInlineFormatter>(node_id);
    }
    // Format the actual output
    for (size_t i = 0; i < ast.size(); ++i) {
        size_t node_id = ast.size() - 1 - i;
        formatNode<FormattingMode::Compact, FormattingBuffer>(node_id);
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
