#include "dashql/formatter/formatter.h"

#include <vector>

#include "dashql/formatter/formatting_program.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;
using ExpressionOperator = buffers::parser::ExpressionOperator;

namespace {

struct OperatorPrecedence {
    size_t precedence;
    Formatter::Associativity associativity;
};

OperatorPrecedence GetOperatorPrecedence(ExpressionOperator op) {
    switch (op) {
        case ExpressionOperator::OR:
            return {3, Formatter::Associativity::Left};
        case ExpressionOperator::AND:
            return {4, Formatter::Associativity::Left};
        case ExpressionOperator::NOT:
            return {5, Formatter::Associativity::Right};
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
        case ExpressionOperator::PLUS:
        case ExpressionOperator::MINUS:
            return {12, Formatter::Associativity::Left};
        case ExpressionOperator::MULTIPLY:
        case ExpressionOperator::DIVIDE:
        case ExpressionOperator::MODULUS:
            return {13, Formatter::Associativity::Left};
        case ExpressionOperator::XOR:
            return {14, Formatter::Associativity::Left};
        case ExpressionOperator::AT_TIMEZONE:
            return {15, Formatter::Associativity::Left};
        case ExpressionOperator::COLLATE:
            return {16, Formatter::Associativity::Left};
        case ExpressionOperator::NEGATE:
            return {17, Formatter::Associativity::Right};
        case ExpressionOperator::TYPECAST:
            return {20, Formatter::Associativity::Left};
        case ExpressionOperator::DEFAULT:
            return {0, Formatter::Associativity::NonAssoc};
    }
}

enum class OperatorBreakPreference { BreakBefore, BreakAfter };

OperatorBreakPreference GetOperatorBreakPreference(ExpressionOperator op) {
    switch (op) {
        case ExpressionOperator::OR:
        case ExpressionOperator::AND:
            return OperatorBreakPreference::BreakBefore;
        default:
            return OperatorBreakPreference::BreakAfter;
    }
}

std::string_view GetOperatorText(ExpressionOperator op, size_t arg_count) {
    if (arg_count == 1) {
        switch (op) {
            case ExpressionOperator::NEGATE:
                return "-";
            case ExpressionOperator::NOT:
                return "not ";
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
        case ExpressionOperator::LIKE:
            return "like";
        case ExpressionOperator::NOT_LIKE:
            return "not like";
        case ExpressionOperator::IS_NULL:
            return "is null";
        case ExpressionOperator::NOT_NULL:
            return "is not null";
        default:
            return "";
    }
}

}  // namespace

Formatter::Formatter(ParsedScript& parsed)
    : scanned(*parsed.scanned_script),
      parsed(parsed),
      ast(parsed.GetNodes().data(), parsed.GetNodes().size()),
      config(),
      fmt(),
      node_states(parsed.GetNodes().size()) {
    for (const auto& statement : parsed.statements) {
        if (statement.root < node_states.size()) {
            node_states[statement.root].is_statement_root = true;
        }
    }
}

size_t Formatter::EstimateFormattedSize() const { return scanned.GetInput().size() + 64; }

void Formatter::PreparePrecedence() {
    for (size_t i = 0; i < ast.size(); ++i) {
        const auto& node = ast[i];
        if (node.node_type() != NodeType::OBJECT_SQL_NARY_EXPRESSION) continue;

        auto [op_node, args_node] =
            GetAttributes<AttributeKey::SQL_EXPRESSION_OPERATOR, AttributeKey::SQL_EXPRESSION_ARGS>(node);
        if (!op_node || op_node->node_type() != NodeType::ENUM_SQL_EXPRESSION_OPERATOR) continue;

        auto op = static_cast<ExpressionOperator>(op_node->children_begin_or_value());
        auto [precedence, associativity] = GetOperatorPrecedence(op);
        auto& state = node_states[i];
        state.precedence = precedence;
        state.associativity = associativity;
        if (args_node) {
            auto& args_state = GetState(*args_node);
            args_state.precedence = precedence;
            args_state.associativity = associativity;
        }
    }
}

void Formatter::IdentifyParentheses(size_t node_id) {
    const auto& node = ast[node_id];
    if (node.node_type() != NodeType::OBJECT_SQL_NARY_EXPRESSION) return;

    auto& state = node_states[node_id];
    size_t parent_id = node.parent();
    if (parent_id >= ast.size()) return;

    const auto& parent = ast[parent_id];
    if (parent.node_type() != NodeType::ARRAY) return;

    size_t args_begin = parent.children_begin_or_value();
    size_t args_count = parent.children_count();
    if (node_id < args_begin || node_id >= args_begin + args_count) return;

    size_t arg_index = node_id - args_begin;
    const auto& parent_state = node_states[parent_id];

    bool need_parens = false;
    if (args_count == 1) {
        need_parens = true;
    } else {
        need_parens = (state.precedence < parent_state.precedence) ||
                      (state.precedence == parent_state.precedence &&
                       ((arg_index == 0 && (parent_state.associativity == Associativity::Right ||
                                            parent_state.associativity == Associativity::NonAssoc)) ||
                        (arg_index == args_count - 1 && (parent_state.associativity == Associativity::Left ||
                                                         parent_state.associativity == Associativity::NonAssoc)) ||
                        (arg_index > 0 && arg_index + 1 < args_count)));
    }
    state.needs_parentheses = need_parens;
}

FmtReg Formatter::FormatLeaf(const buffers::parser::Node& node) {
    return fmt.Text(scanned.ReadTextAtLocation(node.location()));
}

FmtReg Formatter::FormatUnimplemented(const buffers::parser::Node& node) {
    std::string_view type_name = buffers::parser::EnumNameNodeType(node.node_type());
    return fmt.Concat({fmt.Text("<"), fmt.Text(type_name), fmt.Text(">")});
}

FmtReg Formatter::FormatCommaList(const buffers::parser::Node& node) {
    auto children = GetArrayStates(node);
    std::vector<FmtReg> parts;
    parts.reserve(children.size());
    for (auto& child : children) {
        parts.push_back(child.reg);
    }
    auto inline_separator = fmt.Text(", ");
    auto break_separator = fmt.Concat({fmt.Text(","), fmt.BreakIndented()});
    auto policy = config.mode == buffers::formatting::FormattingMode::PRETTY ? FormattingJoinPolicy::BreakAllOrNone
                                                                             : FormattingJoinPolicy::BreakOnOverflow;
    return fmt.Join(parts, inline_separator, break_separator, policy);
}

FmtReg Formatter::FormatQualifiedName(const buffers::parser::Node& node) {
    auto children = GetArrayStates(node);
    if (children.empty()) return fmt.Empty();

    std::vector<FmtReg> parts;
    parts.reserve(children.size());
    for (auto& child : children) {
        parts.push_back(child.reg);
    }
    auto inline_separator = fmt.Text(".");
    auto break_separator = fmt.Concat({fmt.BreakIndented(), fmt.Text(".")});
    auto policy = config.mode == buffers::formatting::FormattingMode::PRETTY ? FormattingJoinPolicy::BreakAllOrNone
                                                                             : FormattingJoinPolicy::BreakOnOverflow;
    return fmt.Join(parts, inline_separator, break_separator, policy);
}

FmtReg Formatter::FormatArray(const buffers::parser::Node& node) {
    switch (node.attribute_key()) {
        case AttributeKey::SQL_SELECT_TARGETS:
        case AttributeKey::SQL_SELECT_FROM:
        case AttributeKey::SQL_SELECT_GROUPS:
        case AttributeKey::SQL_SELECT_ORDER:
            return FormatCommaList(node);
        case AttributeKey::SQL_ROW_LOCKING_OF:
        case AttributeKey::SQL_TEMP_NAME:
        case AttributeKey::SQL_TABLEREF_NAME:
        case AttributeKey::SQL_COLUMN_REF_PATH:
            return FormatQualifiedName(node);
        default:
            return FormatUnimplemented(node);
    }
}

FmtReg Formatter::FormatTableRef(const buffers::parser::Node& node) {
    auto [name, alias] = GetAttributes<AttributeKey::SQL_TABLEREF_NAME, AttributeKey::SQL_TABLEREF_ALIAS>(node);
    if (alias) return FormatUnimplemented(node);
    if (name) return GetState(*name).reg;
    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatColumnRef(const buffers::parser::Node& node) {
    auto [path] = GetAttributes<AttributeKey::SQL_COLUMN_REF_PATH>(node);
    if (path) return GetState(*path).reg;
    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatResultTarget(const buffers::parser::Node& node) {
    auto [value, name, star] =
        GetAttributes<AttributeKey::SQL_RESULT_TARGET_VALUE, AttributeKey::SQL_RESULT_TARGET_NAME,
                      AttributeKey::SQL_RESULT_TARGET_STAR>(node);
    if (name) return FormatUnimplemented(node);
    if (star) return FormatUnimplemented(*star);
    if (value) return GetState(*value).reg;
    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatExpression(size_t node_id) {
    const auto& node = ast[node_id];
    const auto& state = node_states[node_id];

    auto [op_node, args_node] =
        GetAttributes<AttributeKey::SQL_EXPRESSION_OPERATOR, AttributeKey::SQL_EXPRESSION_ARGS>(node);
    if (!op_node || !args_node || op_node->node_type() != NodeType::ENUM_SQL_EXPRESSION_OPERATOR ||
        args_node->node_type() != NodeType::ARRAY || args_node->children_count() == 0) {
        return FormatUnimplemented(node);
    }

    auto op = static_cast<ExpressionOperator>(op_node->children_begin_or_value());
    auto op_text = GetOperatorText(op, args_node->children_count());
    if (op_text.empty()) return FormatUnimplemented(node);

    std::vector<FmtReg> args;
    auto children = GetArrayStates(*args_node);
    args.reserve(children.size());
    for (auto& child : children) {
        args.push_back(child.reg);
    }

    FmtReg reg = fmt.Empty();
    if (args.size() == 1) {
        reg = fmt.Concat({fmt.Text(op_text), args.front()});
    } else {
        FmtReg inline_separator = fmt.Empty();
        FmtReg break_separator = fmt.Empty();
        switch (GetOperatorBreakPreference(op)) {
            case OperatorBreakPreference::BreakBefore:
                inline_separator = fmt.Concat({fmt.Text(" "), fmt.Text(op_text), fmt.Text(" ")});
                break_separator = fmt.Concat({fmt.BreakIndented(), fmt.Text(op_text), fmt.Text(" ")});
                break;
            case OperatorBreakPreference::BreakAfter:
                inline_separator = fmt.Concat({fmt.Text(" "), fmt.Text(op_text), fmt.Text(" ")});
                break_separator = fmt.Concat({fmt.Text(" "), fmt.Text(op_text), fmt.BreakIndented()});
                break;
        }
        bool is_boolean_chain = op == ExpressionOperator::AND || op == ExpressionOperator::OR;
        auto policy = (is_boolean_chain && config.mode == buffers::formatting::FormattingMode::PRETTY)
                          ? FormattingJoinPolicy::BreakAllOrNone
                          : FormattingJoinPolicy::BreakOnOverflow;
        reg = fmt.Join(args, inline_separator, break_separator, policy);
    }

    if (state.needs_parentheses) {
        auto mode = config.mode == buffers::formatting::FormattingMode::PRETTY
                        ? FormattingParenthesisMode::BreakAndIndent
                        : FormattingParenthesisMode::Inline;
        reg = fmt.Parenthesized(reg, mode);
    }
    return reg;
}

FmtReg Formatter::FormatSelect(size_t node_id) {
    const auto& node = ast[node_id];
    const auto& state = node_states[node_id];
    if (!state.is_statement_root) return FormatUnimplemented(node);

    auto [select_all, select_targets, select_into, select_from, select_where, select_groups, select_having,
          select_windows, select_order, select_row_locking, select_with_ctes, select_with_recursive, select_offset,
          select_limit, select_limit_all, select_sample, select_values] =
        GetAttributes<AttributeKey::SQL_SELECT_ALL, AttributeKey::SQL_SELECT_TARGETS, AttributeKey::SQL_SELECT_INTO,
                      AttributeKey::SQL_SELECT_FROM, AttributeKey::SQL_SELECT_WHERE, AttributeKey::SQL_SELECT_GROUPS,
                      AttributeKey::SQL_SELECT_HAVING, AttributeKey::SQL_SELECT_WINDOWS, AttributeKey::SQL_SELECT_ORDER,
                      AttributeKey::SQL_SELECT_ROW_LOCKING, AttributeKey::SQL_SELECT_WITH_CTES,
                      AttributeKey::SQL_SELECT_WITH_RECURSIVE, AttributeKey::SQL_SELECT_OFFSET,
                      AttributeKey::SQL_SELECT_LIMIT, AttributeKey::SQL_SELECT_LIMIT_ALL,
                      AttributeKey::SQL_SELECT_SAMPLE, AttributeKey::SQL_SELECT_VALUES>(node);

    if (select_into || select_windows || select_row_locking || select_with_ctes || select_with_recursive ||
        select_sample || select_values || select_limit_all) {
        return FormatUnimplemented(node);
    }

    std::vector<FmtReg> clauses;
    clauses.reserve(8);
    if (select_targets) {
        auto body = GetState(*select_targets).reg;
        clauses.push_back(fmt.Concat({fmt.Text("select "), body}));
    }
    if (select_from) {
        auto body = GetState(*select_from).reg;
        clauses.push_back(fmt.Concat({fmt.Text("from "), body}));
    }
    if (select_where) {
        auto body = GetState(*select_where).reg;
        clauses.push_back(fmt.Concat({fmt.Text("where "), body}));
    }
    if (select_groups) {
        auto body = GetState(*select_groups).reg;
        clauses.push_back(fmt.Concat({fmt.Text("group by "), body}));
    }
    if (select_having) {
        auto body = GetState(*select_having).reg;
        clauses.push_back(fmt.Concat({fmt.Text("having "), body}));
    }
    if (select_order) {
        auto body = GetState(*select_order).reg;
        clauses.push_back(fmt.Concat({fmt.Text("order by "), body}));
    }
    if (select_limit) {
        auto body = GetState(*select_limit).reg;
        clauses.push_back(fmt.Concat({fmt.Text("limit "), body}));
    }
    if (select_offset) {
        auto body = GetState(*select_offset).reg;
        clauses.push_back(fmt.Concat({fmt.Text("offset "), body}));
    }

    if (clauses.empty()) return FormatUnimplemented(node);
    auto clause_policy = config.mode == buffers::formatting::FormattingMode::INLINE || clauses.size() == 1
                             ? FormattingJoinPolicy::BreakAllOrNone
                             : FormattingJoinPolicy::ForceBreak;
    return fmt.Join(clauses, fmt.Text(" "), fmt.Break(), clause_policy);
}

FmtReg Formatter::FormatNode(size_t node_id) {
    const auto& node = ast[node_id];
    switch (node.node_type()) {
        case NodeType::ARRAY:
            return FormatArray(node);
        case NodeType::OBJECT_SQL_SELECT:
            return FormatSelect(node_id);
        case NodeType::OBJECT_SQL_TABLEREF:
            return FormatTableRef(node);
        case NodeType::OBJECT_SQL_COLUMN_REF:
            return FormatColumnRef(node);
        case NodeType::OBJECT_SQL_RESULT_TARGET:
            return FormatResultTarget(node);
        case NodeType::OBJECT_SQL_NARY_EXPRESSION:
            return FormatExpression(node_id);
        case NodeType::LITERAL_NULL:
        case NodeType::LITERAL_INTEGER:
        case NodeType::LITERAL_FLOAT:
        case NodeType::LITERAL_STRING:
        case NodeType::LITERAL_INTERVAL:
        case NodeType::BOOL:
        case NodeType::NAME:
            return FormatLeaf(node);
        default:
            return FormatUnimplemented(node);
    }
}

void Formatter::BuildDocs() {
    for (size_t node_id = 0; node_id < ast.size(); ++node_id) {
        node_states[node_id].reg = FormatNode(node_id);
    }
}

std::string Formatter::WriteOutput() const {
    FormattingRenderOptions options{
        .max_width = config.max_width,
        .indentation_width = config.indentation_width,
        .debug_mode = config.debug_mode,
        .mode = config.mode,
    };

    std::string output;
    output.reserve(EstimateFormattedSize());

    if (config.debug_mode) {
        output += "/* indentation=";
        output += std::to_string(config.indentation_width);
        output += ", max_width=";
        output += std::to_string(config.max_width);
        output += " */\n";
    }

    for (size_t i = 0; i < parsed.statements.size(); ++i) {
        const auto& statement = parsed.statements[i];
        output += fmt.Render(node_states[statement.root].reg, options);
        if (i + 1 < parsed.statements.size()) {
            output += '\n';
        }
    }
    return output;
}

std::string Formatter::Format(const buffers::formatting::FormattingConfigT& config) {
    this->config = config;
    fmt.Reset();
    node_states.assign(ast.size(), {});
    for (const auto& statement : parsed.statements) {
        if (statement.root < node_states.size()) {
            node_states[statement.root].is_statement_root = true;
        }
    }

    PreparePrecedence();
    for (size_t i = 0; i < ast.size(); ++i) {
        IdentifyParentheses(ast.size() - 1 - i);
    }
    BuildDocs();
    return WriteOutput();
}

}  // namespace dashql
