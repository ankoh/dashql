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

template <typename... Ts> constexpr std::tuple<Ts...> Fmt(Ts... ts) { return std::tuple<Ts...>(std::move(ts)...); }
template <typename V> constexpr std::optional<V> If(bool cond, V v) {
    return cond ? std::optional{std::move(v)} : std::nullopt;
}
template <typename V1, typename V2>
constexpr std::tuple<std::optional<V1>, std::optional<V2>> IfElse(bool cond, V1 v1, V2 v2) {
    return cond ? std::tuple<std::optional<V1>, std::optional<V2>>{std::optional{std::move(v1)}, std::nullopt}
                : std::tuple<std::optional<V1>, std::optional<V2>>{std::nullopt, std::optional{std::move(v2)}};
}
template <Formatter::Mode... Strats> constexpr bool Is(Formatter::Mode have) {
    constexpr uint8_t mask = (static_cast<uint8_t>(Strats) | ... | 0);
    return (static_cast<uint8_t>(have) & mask) != 0;
}
constexpr bool Inline(Formatter::Mode have) { return Is<Formatter::Mode::Inline>(have); }
template <Formatter::Mode... Strats> constexpr bool Not(Formatter::Mode have) { return !Is<Strats...>(have); }

template <FormattingTarget Target>
constexpr bool WouldOverflow(Target& out, size_t offset, const FormattingConfig& config, size_t n) {
    return (out.GetLineWidth(offset) + n) > config.max_width;
}
template <FormattingTarget Target>
constexpr bool BreakOnOverflow(Target& out, size_t offset, const Indent& indent, const FormattingConfig& config,
                               size_t inline_node_width) {
    if (WouldOverflow(out, offset, config, 1 + inline_node_width)) {
        out << LineBreak << indent;
        return true;
    } else {
        out << " ";
        return false;
    }
}

/// Helper to format a comma separated list
template <Formatter::Mode mode, FormattingTarget Target>
void formatCommaSeparated(Target& out, size_t offset, const Indent& indent, const FormattingConfig& config,
                          std::span<Formatter::NodeState> children) {
    switch (mode) {
        // a, b, c, d
        case Formatter::Mode::Inline:
            for (size_t i = 0; i < children.size(); ++i) {
                if (i > 0) {
                    out << ", ";
                }
                out << children[i].Get<Target>();
            }
            break;

        // a, b,
        // c, d
        case Formatter::Mode::Compact:
            for (size_t i = 0; i < children.size(); ++i) {
                if (i > 0) {
                    auto& next = children[i].Get<SimulatedInlineFormatter>();
                    if ((out.GetLineWidth(offset) + 2 + next.GetLineWidth()) > config.max_width) {
                        out << "," << LineBreak << indent;
                    } else {
                        out << ", ";
                    }
                }
                out << children[i].Get<Target>();
            }
            break;

        // a,
        // b,
        // c,
        // d
        case Formatter::Mode::Pretty:
            for (size_t i = 0; i < children.size(); ++i) {
                if (i > 0) {
                    out << "," << LineBreak << indent;
                }
                out << children[i].Get<Target>();
            }
            break;
    }
}

// Helper to format an operator separated list
template <Formatter::Mode mode, FormattingTarget Target>
void formatOperatorSeparated(Target& out, size_t offset, const Indent& indent, const FormattingConfig& config,
                             std::span<Formatter::NodeState> children, std::string_view op) {
    switch (mode) {
        // a AND b AND c AND d
        case Formatter::Mode::Inline:
            for (size_t i = 0; i < children.size(); ++i) {
                if (i > 0) {
                    out << " " << op << " ";
                }
                out << children[i].Get<Target>();
            }
            break;

        // a AND b AND
        // c AND d
        case Formatter::Mode::Compact:
            for (size_t i = 0; i < children.size(); ++i) {
                if (i > 0) {
                    auto& inlined = children[i].Get<SimulatedInlineFormatter>();
                    if ((out.GetLineWidth(offset) + op.size() + 2 + inlined.GetLineWidth()) > config.max_width) {
                        out << op << LineBreak << indent;
                    } else {
                        out << " " << op << " ";
                    }
                }
                out << children[i].Get<Target>();
            }
            break;

        // a
        // AND b
        // AND c
        // AND d
        case Formatter::Mode::Pretty:
            for (size_t i = 0; i < children.size(); ++i) {
                if (i > 0) {
                    out << op << LineBreak << indent;
                }
                out << children[i].Get<Target>();
            }
            break;
    }
}

template <Formatter::Mode mode, FormattingTarget Out> void Formatter::formatNode(size_t node_id) {
    const buffers::parser::Node& node = ast[node_id];
    NodeState& state = node_states[node_id];
    size_t ofs = state.offset;
    Indent indent = state.indent;
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
                switch (mode) {
                    case Mode::Inline:
                    case Mode::Compact:
                        out << " ";
                        break;
                    case Mode::Pretty:
                        BreakOnOverflow(out, ofs, indent + 1, config, GetInlineNodeWidth(*select_from));
                        break;
                }
                formatCommaSeparated<mode>(out, ofs, indent + 1, config, GetArrayStates(*select_targets));
            }
            if (select_from && select_from->node_type() == NodeType::ARRAY) {
                switch (mode) {
                    case Mode::Inline:
                        out << " from ";
                        break;
                    case Mode::Compact:
                        out << LineBreak << indent;
                        out << "from";
                        break;
                    case Mode::Pretty:
                        out << LineBreak << indent;
                        out << "from";
                        BreakOnOverflow(out, ofs, indent + 1, config, GetInlineNodeWidth(*select_from));
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

template <> void Formatter::formatNode<Formatter::Mode::Inline, SimulatedInlineFormatter>(size_t node_id);
template <> void Formatter::formatNode<Formatter::Mode::Inline, FormattingBuffer>(size_t node_id);
template <> void Formatter::formatNode<Formatter::Mode::Pretty, FormattingBuffer>(size_t node_id);
template <> void Formatter::formatNode<Formatter::Mode::Compact, FormattingBuffer>(size_t node_id);

size_t Formatter::EstimateFormattedSize() const {
    size_t input_length = scanned.GetInput().size();
    size_t prev_statement_length = 0;
    size_t new_statement_length = 0;

    for (auto& statement : parsed.statements) {
        prev_statement_length += ast[statement.root].location().length();
    }
    for (auto& node_state : node_states) {
        new_statement_length += node_state.out.own_characters;
    }
    assert(input_length >= prev_statement_length);
    return input_length - prev_statement_length + new_statement_length + 2 /* Padding */;
}

std::string Formatter::Format(const FormattingConfig& config) {
    // Measuring phase
    for (size_t i = 0; i < ast.size(); ++i) {
        size_t node_id = i;
        formatNode<Mode::Inline, SimulatedInlineFormatter>(node_id);
    }
    // Formatting phase
    for (size_t i = 0; i < ast.size(); ++i) {
        size_t node_id = ast.size() - 1 - i;
        formatNode<Mode::Compact, FormattingBuffer>(node_id);
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
