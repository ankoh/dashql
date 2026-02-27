#include "dashql/formatter/formatter.h"

#include <functional>

#include "dashql/buffers/index_generated.h"
#include "dashql/formatter/formatting_target.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;
using ExpressionOperator = buffers::parser::ExpressionOperator;

namespace {

/// Precedence levels and associativity from grammar/precedences.y (lowest to highest).
/// Used to decide when parentheses are needed when rendering expressions.
struct OperatorPrecedence {
    size_t precedence;
    Formatter::Associativity associativity;
};

OperatorPrecedence GetOperatorPrecedence(ExpressionOperator op) {
    switch (op) {
        // %left OR (level 3)
        case ExpressionOperator::OR:
            return {3, Formatter::Associativity::Left};
        // %left AND (level 4)
        case ExpressionOperator::AND:
            return {4, Formatter::Associativity::Left};
        // %right NOT (level 5)
        case ExpressionOperator::NOT:
            return {5, Formatter::Associativity::Right};
        // %nonassoc IS, comparison, BETWEEN, IN, LIKE, etc (level 6–7)
        case ExpressionOperator::IS_NULL:
        case ExpressionOperator::NOT_NULL:
        case ExpressionOperator::IS_TRUE:
        case ExpressionOperator::IS_FALSE:
        case ExpressionOperator::IS_UNKNOWN:
        case ExpressionOperator::IS_DISTINCT_FROM:
        case ExpressionOperator::IS_OF:
        case ExpressionOperator::IS_NOT_TRUE:
        case ExpressionOperator::IS_NOT_FALSE:
        case ExpressionOperator::IS_NOT_UNKNOWN:
        case ExpressionOperator::IS_NOT_DISTINCT_FROM:
        case ExpressionOperator::IS_NOT_OF:
        case ExpressionOperator::EQUAL:
        case ExpressionOperator::NOT_EQUAL:
        case ExpressionOperator::GREATER_EQUAL:
        case ExpressionOperator::GREATER_THAN:
        case ExpressionOperator::LESS_EQUAL:
        case ExpressionOperator::LESS_THAN:
            return {6, Formatter::Associativity::NonAssoc};
        case ExpressionOperator::BETWEEN_SYMMETRIC:
        case ExpressionOperator::BETWEEN_ASYMMETRIC:
        case ExpressionOperator::NOT_BETWEEN_SYMMETRIC:
        case ExpressionOperator::NOT_BETWEEN_ASYMMETRIC:
        case ExpressionOperator::IN:
        case ExpressionOperator::NOT_IN:
        case ExpressionOperator::GLOB:
        case ExpressionOperator::NOT_GLOB:
        case ExpressionOperator::LIKE:
        case ExpressionOperator::NOT_LIKE:
        case ExpressionOperator::ILIKE:
        case ExpressionOperator::NOT_ILIKE:
        case ExpressionOperator::SIMILAR_TO:
        case ExpressionOperator::NOT_SIMILAR_TO:
        case ExpressionOperator::OVERLAPS:
            return {7, Formatter::Associativity::NonAssoc};
        // %left Op OPERATOR (level 11) – user-defined, treat as same as PLUS/MINUS
        // %left PLUS MINUS (level 12)
        case ExpressionOperator::PLUS:
        case ExpressionOperator::MINUS:
            return {12, Formatter::Associativity::Left};
        // %left STAR DIVIDE MODULO (level 13)
        case ExpressionOperator::MULTIPLY:
        case ExpressionOperator::DIVIDE:
        case ExpressionOperator::MODULUS:
            return {13, Formatter::Associativity::Left};
        // %left CIRCUMFLEX (level 14)
        case ExpressionOperator::XOR:
            return {14, Formatter::Associativity::Left};
        // %left AT (level 15)
        case ExpressionOperator::AT_TIMEZONE:
            return {15, Formatter::Associativity::Left};
        // %left COLLATE (level 16)
        case ExpressionOperator::COLLATE:
            return {16, Formatter::Associativity::Left};
        // %right UMINUS (level 17)
        case ExpressionOperator::NEGATE:
            return {17, Formatter::Associativity::Right};
        // %left TYPECAST (level 20)
        case ExpressionOperator::TYPECAST:
            return {20, Formatter::Associativity::Left};
        default:
            return {0, Formatter::Associativity::NonAssoc};
    }
}

/// Return the display text for an expression operator (binary: " + ", " and "; unary: "- ", "not ").
std::string_view GetOperatorText(ExpressionOperator op, size_t arg_count) {
    if (arg_count == 1) {
        switch (op) {
            case ExpressionOperator::NEGATE:
                return "-";
            case ExpressionOperator::NOT:
                return "not";
            default:
                break;
        }
    }
    switch (op) {
        case ExpressionOperator::PLUS:
            return "+";
        case ExpressionOperator::MINUS:
            return "-";
        case ExpressionOperator::MULTIPLY:
            return "*";
        case ExpressionOperator::DIVIDE:
            return "/";
        case ExpressionOperator::MODULUS:
            return "%";
        case ExpressionOperator::AND:
            return "and";
        case ExpressionOperator::OR:
            return "or";
        case ExpressionOperator::XOR:
            return "#";
        case ExpressionOperator::EQUAL:
            return "=";
        case ExpressionOperator::NOT_EQUAL:
            return "<>";
        case ExpressionOperator::LESS_THAN:
            return "<";
        case ExpressionOperator::GREATER_THAN:
            return ">";
        case ExpressionOperator::LESS_EQUAL:
            return "<=";
        case ExpressionOperator::GREATER_EQUAL:
            return ">=";
        default:
            return "";
    }
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

// Helper to format an operator separated list.
// When a child has render_with_parentheses set, it is wrapped in ( ) in the output.
template <FormattingMode mode, FormattingTarget Target>
constexpr void formatExpression(Target& out, const Indent& indent, const FormattingConfig& config,
                                ExpressionOperator op_enum, std::span<Formatter::NodeState> children) {
    const size_t n = children.size();
    std::string_view op = GetOperatorText(op_enum, n);

    // Unary: prefix operator (e.g. - or not) then the single operand
    if (n == 1) {
        out << op;
        if (children[0].render_with_parentheses) out << "(";
        out << Inline<Target>(children[0], indent, out.GetLineWidth());
        if (children[0].render_with_parentheses) out << ")";
        return;
    }
    switch (mode) {
        // a AND b AND c AND d  [or (a+b) AND (c+d) when render_with_parentheses]
        case FormattingMode::Inline:
            for (size_t i = 0; i < children.size(); ++i) {
                if (i > 0) {
                    out << " " << op << " ";
                }
                if (children[i].render_with_parentheses) out << "(";
                out << Inline<Target>(children[i], indent, out.GetLineWidth());
                if (children[i].render_with_parentheses) out << ")";
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
                if (children[i].render_with_parentheses) out << "(";
                if ((*out.GetLineWidth() + *child.GetLineWidth()) <= config.max_width) {
                    out << Inline<Target>(children[i], indent, out.GetLineWidth());
                } else {
                    out << Compact<Target>(children[i], indent, out.GetLineWidth());
                }
                if (children[i].render_with_parentheses) out << ")";
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
                if (children[i].render_with_parentheses) out << "(";
                out << Pretty<Target>(children[i], indent, out.GetLineWidth());
                if (children[i].render_with_parentheses) out << ")";
            }
            break;
    }
}

}  // namespace

void Formatter::PreparePrecedence() {
    for (size_t i = 0; i < ast.size(); ++i) {
        const buffers::parser::Node& node = ast[i];
        if (node.node_type() != NodeType::OBJECT_SQL_NARY_EXPRESSION) continue;

        auto [op_node, args_node] =
            GetNodeAttributes<AttributeKey::SQL_EXPRESSION_OPERATOR, AttributeKey::SQL_EXPRESSION_ARGS>(node);
        if (!op_node || op_node->node_type() != NodeType::ENUM_SQL_EXPRESSION_OPERATOR) continue;

        auto op = static_cast<ExpressionOperator>(op_node->children_begin_or_value());
        auto [precedence, associativity] = GetOperatorPrecedence(op);
        NodeState& state = node_states[i];
        state.precedence = precedence;
        state.associativity = associativity;
    }
}

void Formatter::IdentifyParentheses() {
    // Right-to-left: visit parents before children so we can decide parens from parent context.
    for (size_t idx = 0; idx < ast.size(); ++idx) {
        size_t node_id = ast.size() - 1 - idx;
        const buffers::parser::Node& node = ast[node_id];
        if (node.node_type() != NodeType::OBJECT_SQL_NARY_EXPRESSION) continue;

        NodeState& state = node_states[node_id];
        size_t pi = node.parent();
        if (pi >= ast.size()) continue;
        const buffers::parser::Node& pnode = ast[pi];
        // Expression operands are stored in the args ARRAY; our parent is the ARRAY, not the n-ary expression.
        if (pnode.node_type() != NodeType::ARRAY) continue;
        size_t args_begin = pnode.children_begin_or_value();
        size_t n = pnode.children_count();
        if (node_id < args_begin || node_id >= args_begin + n) continue;
        size_t i = node_id - args_begin;
        size_t expr_parent_id = pnode.parent();
        if (expr_parent_id >= ast.size()) continue;
        const buffers::parser::Node& expr_parent = ast[expr_parent_id];
        if (expr_parent.node_type() != NodeType::OBJECT_SQL_NARY_EXPRESSION) continue;

        const NodeState& pstate = node_states[expr_parent_id];
        size_t my_prec = state.precedence;
        size_t parent_prec = pstate.precedence;
        Associativity parent_assoc = pstate.associativity;

        bool need_parens = false;
        if (n == 1) {
            need_parens = true;  // unary: e.g. -(a+b)
        } else {
            need_parens =
                (my_prec != parent_prec) ||
                (my_prec == parent_prec &&
                 ((i == 0 && (parent_assoc == Associativity::Left || parent_assoc == Associativity::NonAssoc)) ||
                  (i == n - 1 && (parent_assoc == Associativity::Right || parent_assoc == Associativity::NonAssoc)) ||
                  (i > 0 && i < n - 1)));
        }
        state.render_with_parentheses = need_parens;
    }
}

Formatter::Formatter(std::shared_ptr<ParsedScript> parsed)
    : scanned(*parsed->scanned_script), parsed(*parsed), ast(parsed->GetNodes()), config() {
    node_states.resize(ast.size());
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
        case NodeType::OBJECT_SQL_NARY_EXPRESSION: {
            auto [op_node, args_node] =
                GetNodeAttributes<AttributeKey::SQL_EXPRESSION_OPERATOR, AttributeKey::SQL_EXPRESSION_ARGS>(node);
            if (!op_node || !args_node || op_node->node_type() != NodeType::ENUM_SQL_EXPRESSION_OPERATOR ||
                args_node->node_type() != NodeType::ARRAY) {
                break;
            }
            size_t n = args_node->children_count();
            if (n == 0) break;

            auto op = static_cast<ExpressionOperator>(op_node->children_begin_or_value());
            std::span<NodeState> child_states = GetArrayStates(*args_node);
            formatExpression<mode>(out, out.GetIndent(), config, op, child_states);
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
    this->config = config;

    // Left-to-right: Derive precedence and associativity for nodes
    PreparePrecedence();
    // Right-to-left: decide which expressions need parentheses
    IdentifyParentheses();
    // Left-to-right: Simulate inline formatting
    for (size_t i = 0; i < ast.size(); ++i) {
        size_t node_id = i;
        formatNode<FormattingMode::Inline, SimulatedInlineFormatter>(node_id);
    }
    // Right-to-left: Format the actual output
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
