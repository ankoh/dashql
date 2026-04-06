#include "dashql/formatter/formatter.h"

#include <vector>

#include "dashql/formatter/formatting_program.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;
using ExpressionOperator = buffers::parser::ExpressionOperator;
using ColumnConstraint = buffers::parser::ColumnConstraint;
using TableConstraint = buffers::parser::TableConstraint;
using ConstraintAttribute = buffers::parser::ConstraintAttribute;
using KeyMatch = buffers::parser::KeyMatch;
using KeyActionCommand = buffers::parser::KeyActionCommand;
using KeyActionTrigger = buffers::parser::KeyActionTrigger;
using NumericType = buffers::parser::NumericType;
using CharacterType = buffers::parser::CharacterType;
using OrderDirection = buffers::parser::OrderDirection;
using OrderNullRule = buffers::parser::OrderNullRule;
using KnownFunction = buffers::parser::KnownFunction;

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

std::string_view GetOperatorText(ExpressionOperator op) {
    switch (op) {
        case ExpressionOperator::NEGATE:
            return "-";
        case ExpressionOperator::NOT:
            return "not";
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

std::string_view GetKnownFunctionText(KnownFunction fn) {
    switch (fn) {
        case KnownFunction::COLLATION_FOR:
            return "collation for";
        case KnownFunction::CURRENT_DATE:
            return "current_date";
        case KnownFunction::CURRENT_TIME:
            return "current_time";
        case KnownFunction::CURRENT_TIMESTAMP:
            return "current_timestamp";
        case KnownFunction::LOCALTIME:
            return "localtime";
        case KnownFunction::LOCALTIMESTAMP:
            return "localtimestamp";
        case KnownFunction::CURRENT_ROLE:
            return "current_role";
        case KnownFunction::CURRENT_USER:
            return "current_user";
        case KnownFunction::SESSION_USER:
            return "session_user";
        case KnownFunction::USER:
            return "user";
        case KnownFunction::CURRENT_CATALOG:
            return "current_catalog";
        case KnownFunction::CURRENT_SCHEMA:
            return "current_schema";
        case KnownFunction::CAST:
            return "cast";
        case KnownFunction::EXTRACT:
            return "extract";
        case KnownFunction::OVERLAY:
            return "overlay";
        case KnownFunction::POSITION:
            return "position";
        case KnownFunction::SUBSTRING:
            return "substring";
        case KnownFunction::TREAT:
            return "treat";
        case KnownFunction::TRIM:
            return "trim";
        case KnownFunction::NULLIF:
            return "nullif";
        case KnownFunction::COALESCE:
            return "coalesce";
    }
    return "";
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
    auto break_separator = fmt.Concat({fmt.Text(","), fmt.Break()});
    return fmt.Join(parts, inline_separator, break_separator, std::nullopt, true);
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
    auto break_separator = fmt.Concat({fmt.Break(), fmt.Text(".")});
    return fmt.Join(parts, inline_separator, break_separator, std::nullopt, true);
}

FmtReg Formatter::FormatArray(const buffers::parser::Node& node) {
    switch (node.attribute_key()) {
        case AttributeKey::SQL_SELECT_TARGETS:
        case AttributeKey::SQL_SELECT_FROM:
        case AttributeKey::SQL_SELECT_GROUPS:
        case AttributeKey::SQL_SELECT_ORDER:
        case AttributeKey::SQL_CREATE_TABLE_ELEMENTS:
            return FormatCommaList(node);
        case AttributeKey::SQL_ROW_LOCKING_OF:
        case AttributeKey::SQL_TEMP_NAME:
        case AttributeKey::SQL_CREATE_TABLE_NAME:
        case AttributeKey::SQL_FUNCTION_NAME:
        case AttributeKey::SQL_COLUMN_CONSTRAINT_COLLATE:
        case AttributeKey::SQL_TABLEREF_NAME:
        case AttributeKey::SQL_TABLE_CONSTRAINT_REFERENCES_NAME:
        case AttributeKey::SQL_COLUMN_REF_PATH:
            return FormatQualifiedName(node);
        case AttributeKey::SQL_TABLE_CONSTRAINT_COLUMNS:
        case AttributeKey::SQL_TABLE_CONSTRAINT_REFERENCES_COLUMNS:
            return FormatCommaList(node);
        default:
            return FormatUnimplemented(node);
    }
}

FmtReg Formatter::FormatTableRef(const buffers::parser::Node& node) {
    auto [name, alias] = GetAttributes<AttributeKey::SQL_TABLEREF_NAME, AttributeKey::SQL_TABLEREF_ALIAS>(node);
    if (alias) return FormatUnimplemented(node);
    if (name) return Reg(*name);
    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatTypeName(const buffers::parser::Node& node) {
    auto [type, array, setof] = GetAttributes<AttributeKey::SQL_TYPENAME_TYPE, AttributeKey::SQL_TYPENAME_ARRAY,
                                              AttributeKey::SQL_TYPENAME_SETOF>(node);
    if (!type) return FormatUnimplemented(node);

    std::vector<FmtReg> parts;
    parts.reserve(4);
    if (setof && setof->node_type() == NodeType::BOOL && setof->children_begin_or_value() != 0) {
        parts.push_back(fmt.Text("setof "));
    }
    parts.push_back(Reg(*type));

    if (array && array->node_type() == NodeType::ARRAY && array->children_count() > 0) {
        auto begin = array->children_begin_or_value();
        for (size_t i = 0; i < array->children_count(); ++i) {
            parts.push_back(fmt.Text("["));
            parts.push_back(Reg(ast[begin + i]));
            parts.push_back(fmt.Text("]"));
        }
    }

    return fmt.Concat(std::move(parts));
}

FmtReg Formatter::FormatNumericTypeBase(const buffers::parser::Node& node) {
    if (node.node_type() != NodeType::ENUM_SQL_NUMERIC_TYPE) return FormatUnimplemented(node);

    auto value = static_cast<NumericType>(node.children_begin_or_value());
    switch (value) {
        case NumericType::INT1:
            return fmt.Text("tinyint");
        case NumericType::INT2:
            return fmt.Text("smallint");
        case NumericType::INT4:
            return fmt.Text("integer");
        case NumericType::INT8:
            return fmt.Text("bigint");
        case NumericType::FLOAT4:
            return fmt.Text("real");
        case NumericType::FLOAT8:
            return fmt.Text("double precision");
        case NumericType::NUMERIC:
            return fmt.Text("numeric");
        case NumericType::BOOL:
            return fmt.Text("boolean");
    }

    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatNumericType(const buffers::parser::Node& node) {
    auto [base, modifiers] =
        GetAttributes<AttributeKey::SQL_NUMERIC_TYPE_BASE, AttributeKey::SQL_NUMERIC_TYPE_MODIFIERS>(node);
    if (!base) return FormatUnimplemented(node);

    std::vector<FmtReg> parts;
    parts.reserve(2);
    parts.push_back(Reg(*base));

    if (modifiers && modifiers->node_type() == NodeType::ARRAY && modifiers->children_count() > 0) {
        std::vector<FmtReg> values;
        values.reserve(modifiers->children_count());
        auto begin = modifiers->children_begin_or_value();
        for (size_t i = 0; i < modifiers->children_count(); ++i) {
            values.push_back(Reg(ast[begin + i]));
        }
        auto joined = fmt.Join(values, fmt.Text(", "), fmt.Concat({fmt.Text(","), fmt.Break()}), std::nullopt, true);
        parts.push_back(fmt.Parenthesized(joined));
    }

    return fmt.Concat(std::move(parts));
}

FmtReg Formatter::FormatCharacterTypeBase(const buffers::parser::Node& node) {
    if (node.node_type() != NodeType::ENUM_SQL_CHARACTER_TYPE) return FormatUnimplemented(node);

    auto value = static_cast<CharacterType>(node.children_begin_or_value());
    switch (value) {
        case CharacterType::VARCHAR:
            return fmt.Text("varchar");
        case CharacterType::BLANK_PADDED_CHAR:
            return fmt.Text("char");
    }

    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatCharacterType(const buffers::parser::Node& node) {
    auto [type, length] =
        GetAttributes<AttributeKey::SQL_CHARACTER_TYPE, AttributeKey::SQL_CHARACTER_TYPE_LENGTH>(node);
    if (!type) return FormatUnimplemented(node);

    std::vector<FmtReg> parts;
    parts.reserve(2);
    parts.push_back(Reg(*type));
    if (length) {
        parts.push_back(fmt.Parenthesized(Reg(*length)));
    }
    return fmt.Concat(std::move(parts));
}

FmtReg Formatter::FormatGenericType(const buffers::parser::Node& node) {
    auto [name, modifiers] =
        GetAttributes<AttributeKey::SQL_GENERIC_TYPE_NAME, AttributeKey::SQL_GENERIC_TYPE_MODIFIERS>(node);
    if (!name) return FormatUnimplemented(node);

    std::vector<FmtReg> parts;
    parts.reserve(2);
    parts.push_back(Reg(*name));
    if (modifiers && modifiers->node_type() == NodeType::ARRAY && modifiers->children_count() > 0) {
        std::vector<FmtReg> values;
        values.reserve(modifiers->children_count());
        auto begin = modifiers->children_begin_or_value();
        for (size_t i = 0; i < modifiers->children_count(); ++i) {
            values.push_back(Reg(ast[begin + i]));
        }
        auto joined = fmt.Join(values, fmt.Text(", "), fmt.Concat({fmt.Text(","), fmt.Break()}), std::nullopt, true);
        parts.push_back(fmt.Parenthesized(joined));
    }
    return fmt.Concat(std::move(parts));
}

FmtReg Formatter::FormatOrder(const buffers::parser::Node& node) {
    auto [value, direction, nullrule] = GetAttributes<AttributeKey::SQL_ORDER_VALUE, AttributeKey::SQL_ORDER_DIRECTION,
                                                      AttributeKey::SQL_ORDER_NULLRULE>(node);
    if (!value) return FormatUnimplemented(node);

    std::vector<FmtReg> parts;
    parts.reserve(3);
    parts.push_back(Reg(*value));

    if (direction) parts.push_back(Reg(*direction));

    if (nullrule) parts.push_back(Reg(*nullrule));

    return fmt.Join(parts, fmt.Text(" "), fmt.Break(), FormattingJoinPolicy::BreakAllOrNone, true);
}

FmtReg Formatter::FormatOrderDirection(const buffers::parser::Node& node) {
    if (node.node_type() != NodeType::ENUM_SQL_ORDER_DIRECTION) {
        return FormatUnimplemented(node);
    }

    auto dir = static_cast<OrderDirection>(node.children_begin_or_value());
    switch (dir) {
        case OrderDirection::ASCENDING:
            return fmt.Text("asc");
        case OrderDirection::DESCENDING:
            return fmt.Text("desc");
    }

    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatOrderNullRule(const buffers::parser::Node& node) {
    if (node.node_type() != NodeType::ENUM_SQL_ORDER_NULL_RULE) {
        return FormatUnimplemented(node);
    }

    auto rule = static_cast<OrderNullRule>(node.children_begin_or_value());
    switch (rule) {
        case OrderNullRule::NULLS_FIRST:
            return fmt.Text("nulls first");
        case OrderNullRule::NULLS_LAST:
            return fmt.Text("nulls last");
    }

    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatColumnRef(const buffers::parser::Node& node) {
    auto [path] = GetAttributes<AttributeKey::SQL_COLUMN_REF_PATH>(node);
    if (path) return Reg(*path);
    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatColumnDef(const buffers::parser::Node& node) {
    auto [name, type, options, constraints] =
        GetAttributes<AttributeKey::SQL_COLUMN_DEF_NAME, AttributeKey::SQL_COLUMN_DEF_TYPE,
                      AttributeKey::SQL_COLUMN_DEF_OPTIONS, AttributeKey::SQL_COLUMN_DEF_CONSTRAINTS>(node);

    if (!name || !type) return FormatUnimplemented(node);

    auto reg_or_placeholder = [&](const buffers::parser::Node& child) -> FmtReg {
        auto reg = Reg(child);
        if (reg == 0) return FormatUnimplemented(child);
        return reg;
    };

    std::vector<FmtReg> parts;
    parts.reserve(6);
    parts.push_back(reg_or_placeholder(*name));
    parts.push_back(fmt.Text(" "));
    parts.push_back(reg_or_placeholder(*type));

    if (options) {
        if (options->node_type() != NodeType::ARRAY) {
            parts.push_back(fmt.Text(" "));
            parts.push_back(FormatUnimplemented(*options));
        } else if (options->children_count() > 0) {
            std::vector<FmtReg> option_parts;
            option_parts.reserve(options->children_count());
            auto begin = options->children_begin_or_value();
            for (size_t i = 0; i < options->children_count(); ++i) {
                option_parts.push_back(reg_or_placeholder(ast[begin + i]));
            }

            auto option_list = fmt.Join(option_parts, fmt.Text(", "), fmt.Concat({fmt.Text(","), fmt.Break()}),
                                        FormattingJoinPolicy::BreakOnOverflow, true);
            parts.push_back(fmt.Text(" options "));
            parts.push_back(fmt.Parenthesized(option_list));
        }
    }

    if (constraints) {
        if (constraints->node_type() != NodeType::ARRAY) {
            parts.push_back(fmt.Text(" "));
            parts.push_back(FormatUnimplemented(*constraints));
        } else if (constraints->children_count() > 0) {
            std::vector<FmtReg> constraint_parts;
            constraint_parts.reserve(constraints->children_count());
            auto begin = constraints->children_begin_or_value();
            for (size_t i = 0; i < constraints->children_count(); ++i) {
                constraint_parts.push_back(reg_or_placeholder(ast[begin + i]));
            }

            auto constraint_list =
                fmt.Join(constraint_parts, fmt.Text(" "), fmt.Break(), FormattingJoinPolicy::BreakOnOverflow, true);
            parts.push_back(fmt.Text(" "));
            parts.push_back(constraint_list);
        }
    }

    return fmt.Concat(std::move(parts));
}

FmtReg Formatter::FormatTableConstraintType(const buffers::parser::Node& node) {
    if (node.node_type() != NodeType::ENUM_SQL_TABLE_CONSTRAINT) {
        return FormatUnimplemented(node);
    }

    auto value = static_cast<TableConstraint>(node.children_begin_or_value());
    switch (value) {
        case TableConstraint::CHECK:
            return fmt.Text("check");
        case TableConstraint::UNIQUE:
            return fmt.Text("unique");
        case TableConstraint::PRIMARY_KEY:
            return fmt.Text("primary key");
        case TableConstraint::FOREIGN_KEY:
            return fmt.Text("foreign key");
    }

    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatKeyMatch(const buffers::parser::Node& node) {
    if (node.node_type() != NodeType::ENUM_SQL_KEY_MATCH) {
        return FormatUnimplemented(node);
    }

    auto value = static_cast<KeyMatch>(node.children_begin_or_value());
    switch (value) {
        case KeyMatch::FULL:
            return fmt.Text("match full");
        case KeyMatch::PARTIAL:
            return fmt.Text("match partial");
        case KeyMatch::SIMPLE:
            return fmt.Text("match simple");
    }

    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatKeyActionCommand(const buffers::parser::Node& node) {
    if (node.node_type() != NodeType::ENUM_SQL_KEY_ACTION_COMMAND) {
        return FormatUnimplemented(node);
    }

    auto value = static_cast<KeyActionCommand>(node.children_begin_or_value());
    switch (value) {
        case KeyActionCommand::NO_ACTION:
            return fmt.Text("no action");
        case KeyActionCommand::RESTRICT:
            return fmt.Text("restrict");
        case KeyActionCommand::CASCADE:
            return fmt.Text("cascade");
        case KeyActionCommand::SET_NULL:
            return fmt.Text("set null");
        case KeyActionCommand::SET_DEFAULT:
            return fmt.Text("set default");
    }

    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatKeyActionTrigger(const buffers::parser::Node& node) {
    if (node.node_type() != NodeType::ENUM_SQL_KEY_ACTION_TRIGGER) {
        return FormatUnimplemented(node);
    }

    auto value = static_cast<KeyActionTrigger>(node.children_begin_or_value());
    switch (value) {
        case KeyActionTrigger::UPDATE:
            return fmt.Text("on update");
        case KeyActionTrigger::DELETE:
            return fmt.Text("on delete");
    }

    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatKeyAction(const buffers::parser::Node& node) {
    auto [trigger, command] =
        GetAttributes<AttributeKey::SQL_KEY_ACTION_TRIGGER, AttributeKey::SQL_KEY_ACTION_COMMAND>(node);
    if (!trigger || !command) return FormatUnimplemented(node);
    std::vector<FmtReg> parts;
    parts.reserve(2);
    parts.push_back(Reg(*trigger));
    parts.push_back(Reg(*command));
    return fmt.Join(parts, fmt.Text(" "), fmt.Break(), FormattingJoinPolicy::BreakAllOrNone, true);
}

FmtReg Formatter::FormatTableConstraint(const buffers::parser::Node& node) {
    auto [constraint_type, constraint_name, constraint_argument, constraint_index, constraint_columns,
          constraint_references_name, constraint_references_columns, constraint_attributes, constraint_definition,
          constraint_key_actions, constraint_key_match] =
        GetAttributes<AttributeKey::SQL_TABLE_CONSTRAINT_TYPE, AttributeKey::SQL_TABLE_CONSTRAINT_NAME,
                      AttributeKey::SQL_TABLE_CONSTRAINT_ARGUMENT, AttributeKey::SQL_TABLE_CONSTRAINT_INDEX,
                      AttributeKey::SQL_TABLE_CONSTRAINT_COLUMNS, AttributeKey::SQL_TABLE_CONSTRAINT_REFERENCES_NAME,
                      AttributeKey::SQL_TABLE_CONSTRAINT_REFERENCES_COLUMNS,
                      AttributeKey::SQL_TABLE_CONSTRAINT_ATTRIBUTES, AttributeKey::SQL_TABLE_CONSTRAINT_DEFINITION,
                      AttributeKey::SQL_TABLE_CONSTRAINT_KEY_ACTIONS, AttributeKey::SQL_TABLE_CONSTRAINT_KEY_MATCH>(
            node);

    if (!constraint_type || constraint_type->node_type() != NodeType::ENUM_SQL_TABLE_CONSTRAINT) {
        return FormatUnimplemented(node);
    }

    auto reg_or_placeholder = [&](const buffers::parser::Node& child) -> FmtReg {
        auto reg = Reg(child);
        if (reg == 0) return FormatUnimplemented(child);
        return reg;
    };

    auto format_space_list = [&](const buffers::parser::Node& list) -> FmtReg {
        if (list.node_type() != NodeType::ARRAY) {
            return FormatUnimplemented(list);
        }
        if (list.children_count() == 0) {
            return fmt.Empty();
        }

        std::vector<FmtReg> parts;
        parts.reserve(list.children_count());
        auto begin = list.children_begin_or_value();
        for (size_t i = 0; i < list.children_count(); ++i) {
            parts.push_back(reg_or_placeholder(ast[begin + i]));
        }
        return fmt.Join(parts, fmt.Text(" "), fmt.Break(), FormattingJoinPolicy::BreakOnOverflow, true);
    };

    std::vector<FmtReg> parts;
    parts.reserve(16);

    if (constraint_name) {
        parts.push_back(fmt.Text("constraint "));
        parts.push_back(reg_or_placeholder(*constraint_name));
        parts.push_back(fmt.Text(" "));
    }

    auto ctype = static_cast<TableConstraint>(constraint_type->children_begin_or_value());
    parts.push_back(reg_or_placeholder(*constraint_type));

    switch (ctype) {
        case TableConstraint::CHECK:
            parts.push_back(fmt.Text(" "));
            parts.push_back(fmt.Parenthesized(constraint_argument ? reg_or_placeholder(*constraint_argument)
                                                                  : FormatUnimplemented(node)));
            break;
        case TableConstraint::UNIQUE:
        case TableConstraint::PRIMARY_KEY:
            if (constraint_index) {
                parts.push_back(fmt.Text(" using index "));
                parts.push_back(reg_or_placeholder(*constraint_index));
            } else {
                parts.push_back(fmt.Text(" "));
                parts.push_back(fmt.Parenthesized(constraint_columns ? reg_or_placeholder(*constraint_columns)
                                                                     : FormatUnimplemented(node)));
            }
            break;
        case TableConstraint::FOREIGN_KEY:
            parts.push_back(fmt.Text(" "));
            parts.push_back(fmt.Parenthesized(constraint_columns ? reg_or_placeholder(*constraint_columns)
                                                                 : FormatUnimplemented(node)));
            parts.push_back(fmt.Text(" references "));
            parts.push_back(constraint_references_name ? reg_or_placeholder(*constraint_references_name)
                                                       : FormatUnimplemented(node));
            if (constraint_references_columns && constraint_references_columns->node_type() == NodeType::ARRAY &&
                constraint_references_columns->children_count() > 0) {
                parts.push_back(fmt.Text(" "));
                parts.push_back(fmt.Parenthesized(reg_or_placeholder(*constraint_references_columns)));
            }
            break;
    }

    if (constraint_key_match) {
        parts.push_back(fmt.Text(" "));
        parts.push_back(reg_or_placeholder(*constraint_key_match));
    }

    if (constraint_key_actions) {
        auto actions = format_space_list(*constraint_key_actions);
        if (actions != 0) {
            parts.push_back(fmt.Text(" "));
            parts.push_back(actions);
        }
    }

    if (constraint_attributes) {
        auto attributes = format_space_list(*constraint_attributes);
        if (attributes != 0) {
            parts.push_back(fmt.Text(" "));
            parts.push_back(attributes);
        }
    }

    if (constraint_definition) {
        auto definition = reg_or_placeholder(*constraint_definition);
        if (definition != 0) {
            parts.push_back(fmt.Text(" with "));
            parts.push_back(fmt.Parenthesized(definition));
        }
    }

    return fmt.Concat(std::move(parts));
}

FmtReg Formatter::FormatColumnConstraintType(const buffers::parser::Node& node) {
    if (node.node_type() != NodeType::ENUM_SQL_COLUMN_CONSTRAINT) {
        return FormatUnimplemented(node);
    }

    auto value = static_cast<ColumnConstraint>(node.children_begin_or_value());
    switch (value) {
        case ColumnConstraint::NOT_NULL:
            return fmt.Text("not null");
        case ColumnConstraint::NULL_:
            return fmt.Text("null");
        case ColumnConstraint::UNIQUE:
            return fmt.Text("unique");
        case ColumnConstraint::PRIMARY_KEY:
            return fmt.Text("primary key");
        case ColumnConstraint::CHECK:
            return fmt.Text("check");
        case ColumnConstraint::DEFAULT:
            return fmt.Text("default");
        case ColumnConstraint::COLLATE:
            return fmt.Text("collate");
    }

    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatColumnConstraint(const buffers::parser::Node& node) {
    auto [constraint_type, constraint_name, constraint_value, constraint_no_inherit, constraint_definition,
          constraint_collate] =
        GetAttributes<AttributeKey::SQL_COLUMN_CONSTRAINT_TYPE, AttributeKey::SQL_COLUMN_CONSTRAINT_NAME,
                      AttributeKey::SQL_COLUMN_CONSTRAINT_VALUE, AttributeKey::SQL_COLUMN_CONSTRAINT_NO_INHERIT,
                      AttributeKey::SQL_COLUMN_CONSTRAINT_DEFINITION, AttributeKey::SQL_COLUMN_CONSTRAINT_COLLATE>(
            node);

    if (!constraint_type || constraint_type->node_type() != NodeType::ENUM_SQL_COLUMN_CONSTRAINT) {
        return FormatUnimplemented(node);
    }

    auto reg_or_placeholder = [&](const buffers::parser::Node& child) -> FmtReg {
        auto reg = Reg(child);
        if (reg == 0) return FormatUnimplemented(child);
        return reg;
    };

    std::vector<FmtReg> parts;
    parts.reserve(8);

    if (constraint_name) {
        parts.push_back(fmt.Text("constraint "));
        parts.push_back(reg_or_placeholder(*constraint_name));
        parts.push_back(fmt.Text(" "));
    }

    auto ctype = static_cast<ColumnConstraint>(constraint_type->children_begin_or_value());
    parts.push_back(reg_or_placeholder(*constraint_type));

    switch (ctype) {
        case ColumnConstraint::NOT_NULL:
        case ColumnConstraint::NULL_:
        case ColumnConstraint::UNIQUE:
        case ColumnConstraint::PRIMARY_KEY:
            break;
        case ColumnConstraint::CHECK:
            parts.push_back(fmt.Text(" "));
            parts.push_back(fmt.Parenthesized(constraint_value ? reg_or_placeholder(*constraint_value)
                                                               : FormatUnimplemented(node)));
            if (constraint_no_inherit && constraint_no_inherit->node_type() == NodeType::BOOL &&
                constraint_no_inherit->children_begin_or_value() != 0) {
                parts.push_back(fmt.Text(" no inherit"));
            }
            break;
        case ColumnConstraint::DEFAULT:
            parts.push_back(fmt.Text(" "));
            parts.push_back(constraint_value ? reg_or_placeholder(*constraint_value) : FormatUnimplemented(node));
            break;
        case ColumnConstraint::COLLATE:
            parts.push_back(fmt.Text(" "));
            parts.push_back(constraint_collate ? reg_or_placeholder(*constraint_collate) : FormatUnimplemented(node));
            break;
    }

    if (constraint_definition) {
        auto def_reg = reg_or_placeholder(*constraint_definition);
        if (def_reg != 0) {
            parts.push_back(fmt.Text(" with "));
            parts.push_back(fmt.Parenthesized(def_reg));
        }
    }

    return fmt.Concat(std::move(parts));
}

FmtReg Formatter::FormatConstraintAttribute(const buffers::parser::Node& node) {
    if (node.node_type() != NodeType::ENUM_SQL_CONSTRAINT_ATTRIBUTE) {
        return FormatUnimplemented(node);
    }

    auto value = static_cast<ConstraintAttribute>(node.children_begin_or_value());
    switch (value) {
        case ConstraintAttribute::DEFERRABLE:
            return fmt.Text("deferrable");
        case ConstraintAttribute::NOT_DEFERRABLE:
            return fmt.Text("not deferrable");
        case ConstraintAttribute::INITIALLY_DEFERRED:
            return fmt.Text("initially deferred");
        case ConstraintAttribute::INITIALLY_IMMEDIATE:
            return fmt.Text("initially immediate");
        case ConstraintAttribute::NOT_VALID:
            return fmt.Text("not valid");
        case ConstraintAttribute::NO_INHERIT:
            return fmt.Text("no inherit");
    }

    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatGenericOption(const buffers::parser::Node& node) {
    auto [key, value] =
        GetAttributes<AttributeKey::SQL_GENERIC_OPTION_KEY, AttributeKey::SQL_GENERIC_OPTION_VALUE>(node);
    if (!key || !value) return FormatUnimplemented(node);
    return fmt.Concat({Reg(*key), fmt.Text(" "), Reg(*value)});
}

FmtReg Formatter::FormatFunctionArg(const buffers::parser::Node& node) {
    auto [arg_name, arg_value] =
        GetAttributes<AttributeKey::SQL_FUNCTION_ARG_NAME, AttributeKey::SQL_FUNCTION_ARG_VALUE>(node);
    if (!arg_value) return FormatUnimplemented(node);

    auto value_reg = Reg(*arg_value);
    if (value_reg == 0) return FormatUnimplemented(node);

    if (!arg_name) return value_reg;
    auto name_reg = Reg(*arg_name);
    if (name_reg == 0) return FormatUnimplemented(node);
    return fmt.Concat({name_reg, fmt.Text(" => "), value_reg});
}

FmtReg Formatter::FormatFunctionExpression(const buffers::parser::Node& node) {
    auto [star, all, distinct, variadic, over, within_group, filter, name, args, order, cast_args, extract_args,
          overlay_args, position_args, substring_args, treat_args, trim_args] =
        GetAttributes<AttributeKey::SQL_FUNCTION_ARGUMENTS_STAR, AttributeKey::SQL_FUNCTION_ALL,
                      AttributeKey::SQL_FUNCTION_DISTINCT, AttributeKey::SQL_FUNCTION_VARIADIC,
                      AttributeKey::SQL_FUNCTION_OVER, AttributeKey::SQL_FUNCTION_WITHIN_GROUP,
                      AttributeKey::SQL_FUNCTION_FILTER, AttributeKey::SQL_FUNCTION_NAME,
                      AttributeKey::SQL_FUNCTION_ARGUMENTS, AttributeKey::SQL_FUNCTION_ORDER,
                      AttributeKey::SQL_FUNCTION_CAST_ARGS, AttributeKey::SQL_FUNCTION_EXTRACT_ARGS,
                      AttributeKey::SQL_FUNCTION_OVERLAY_ARGS, AttributeKey::SQL_FUNCTION_POSITION_ARGS,
                      AttributeKey::SQL_FUNCTION_SUBSTRING_ARGS, AttributeKey::SQL_FUNCTION_TREAT_ARGS,
                      AttributeKey::SQL_FUNCTION_TRIM_ARGS>(node);

    if (!name || over || within_group || filter) return FormatUnimplemented(node);
    if (all && distinct) return FormatUnimplemented(node);
    if (cast_args || extract_args || overlay_args || position_args || substring_args || treat_args || trim_args) {
        return FormatUnimplemented(node);
    }

    FmtReg name_reg = 0;
    if (name->node_type() == NodeType::ARRAY) {
        name_reg = Reg(*name);
    } else if (name->node_type() == NodeType::ENUM_SQL_KNOWN_FUNCTION) {
        auto name_text = GetKnownFunctionText(static_cast<KnownFunction>(name->children_begin_or_value()));
        if (name_text.empty()) return FormatUnimplemented(node);
        name_reg = fmt.Text(name_text);
    } else {
        return FormatUnimplemented(node);
    }
    if (name_reg == 0) return FormatUnimplemented(node);

    std::vector<FmtReg> call_parts;
    call_parts.reserve(4);

    if (star) {
        if (args || variadic || all || distinct || order) return FormatUnimplemented(node);
        call_parts.push_back(fmt.Text("*"));
    } else {
        std::vector<FmtReg> arg_items;
        if (args) {
            if (args->node_type() != NodeType::ARRAY) return FormatUnimplemented(node);
            arg_items.reserve(args->children_count());
            auto begin = args->children_begin_or_value();
            for (size_t i = 0; i < args->children_count(); ++i) {
                auto reg = Reg(ast[begin + i]);
                if (reg == 0) return FormatUnimplemented(node);
                arg_items.push_back(reg);
            }
        }

        if (variadic) {
            auto variadic_reg = Reg(*variadic);
            if (variadic_reg == 0) return FormatUnimplemented(node);
            arg_items.push_back(fmt.Concat({fmt.Text("variadic "), variadic_reg}));
        }

        if (all || distinct) {
            if (arg_items.empty()) return FormatUnimplemented(node);
            call_parts.push_back(all ? fmt.Text("all ") : fmt.Text("distinct "));
        }

        if (!arg_items.empty()) {
            call_parts.push_back(fmt.Join(arg_items, fmt.Text(", "), fmt.Concat({fmt.Text(","), fmt.Break()}),
                                          FormattingJoinPolicy::BreakOnOverflow, true));
        }
    }

    if (order) {
        auto order_reg = Reg(*order);
        if (order_reg == 0) return FormatUnimplemented(node);
        if (!call_parts.empty()) {
            call_parts.push_back(fmt.Text(" order by "));
        } else {
            call_parts.push_back(fmt.Text("order by "));
        }
        call_parts.push_back(order_reg);
    }

    auto call_body = fmt.Concat(std::move(call_parts));
    if (call_body == 0) {
        if (name->node_type() == NodeType::ENUM_SQL_KNOWN_FUNCTION) return name_reg;
        return fmt.Concat({name_reg, fmt.Text("()")});
    }
    return fmt.Concat({name_reg, fmt.Parenthesized(call_body)});
}

FmtReg Formatter::FormatExpressionOperatorType(const buffers::parser::Node& node) {
    if (node.node_type() != NodeType::ENUM_SQL_EXPRESSION_OPERATOR) {
        return FormatUnimplemented(node);
    }

    auto op = static_cast<ExpressionOperator>(node.children_begin_or_value());
    auto text = GetOperatorText(op);
    if (text.empty()) return FormatUnimplemented(node);
    return fmt.Text(text);
}

FmtReg Formatter::FormatResultTarget(const buffers::parser::Node& node) {
    auto [value, name, star] =
        GetAttributes<AttributeKey::SQL_RESULT_TARGET_VALUE, AttributeKey::SQL_RESULT_TARGET_NAME,
                      AttributeKey::SQL_RESULT_TARGET_STAR>(node);
    if (name) return FormatUnimplemented(node);
    if (star) return FormatUnimplemented(*star);
    if (value) return Reg(*value);
    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatSelectExpression(const buffers::parser::Node& node) {
    auto [statement, indirection] =
        GetAttributes<AttributeKey::SQL_SELECT_EXPRESSION_STATEMENT, AttributeKey::SQL_SELECT_EXPRESSION_INDIRECTION>(
            node);
    if (!statement) return FormatUnimplemented(node);
    if (indirection && indirection->node_type() == NodeType::ARRAY && indirection->children_count() > 0) {
        return FormatUnimplemented(node);
    }
    return fmt.Parenthesized(Reg(*statement));
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
    auto op_reg = Reg(*op_node);
    if (op_reg == 0) return FormatUnimplemented(node);

    std::vector<FmtReg> args;
    auto children = GetArrayStates(*args_node);
    args.reserve(children.size());
    for (auto& child : children) {
        args.push_back(child.reg);
    }

    FmtReg reg = fmt.Empty();

    if (args.size() == 1) {
        if (op == ExpressionOperator::NEGATE) {
            reg = fmt.Concat({op_reg, args.front()});
        } else {
            reg = fmt.Concat({op_reg, fmt.Text(" "), args.front()});
        }
    } else {
        FmtReg inline_separator = fmt.Empty();
        FmtReg break_separator = fmt.Empty();
        switch (GetOperatorBreakPreference(op)) {
            case OperatorBreakPreference::BreakBefore:
                inline_separator = fmt.Concat({fmt.Text(" "), op_reg, fmt.Text(" ")});
                break_separator = fmt.Concat({fmt.Break(), op_reg, fmt.Text(" ")});
                break;
            case OperatorBreakPreference::BreakAfter:
                inline_separator = fmt.Concat({fmt.Text(" "), op_reg, fmt.Text(" ")});
                break_separator = fmt.Concat({fmt.Text(" "), op_reg, fmt.Break()});
                break;
        }
        bool is_boolean_chain = op == ExpressionOperator::AND || op == ExpressionOperator::OR;
        reg = is_boolean_chain
                  ? fmt.Join(args, inline_separator, break_separator, std::nullopt, true)
                  : fmt.Join(args, inline_separator, break_separator, FormattingJoinPolicy::BreakOnOverflow, true);
    }

    if (state.needs_parentheses) {
        reg = fmt.Parenthesized(reg);
    }
    return reg;
}

FmtReg Formatter::FormatSelect(size_t node_id) {
    const auto& node = ast[node_id];

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
        auto body = Reg(*select_targets);
        clauses.push_back(fmt.Concat({fmt.Text("select "), body}));
    }
    if (select_from) {
        auto body = Reg(*select_from);
        clauses.push_back(fmt.Concat({fmt.Text("from "), body}));
    }
    if (select_where) {
        auto body = Reg(*select_where);
        clauses.push_back(fmt.Concat({fmt.Text("where "), body}));
    }
    if (select_groups) {
        auto body = Reg(*select_groups);
        clauses.push_back(fmt.Concat({fmt.Text("group by "), body}));
    }
    if (select_having) {
        auto body = Reg(*select_having);
        clauses.push_back(fmt.Concat({fmt.Text("having "), body}));
    }
    if (select_order) {
        auto body = Reg(*select_order);
        clauses.push_back(fmt.Concat({fmt.Text("order by "), body}));
    }
    if (select_limit) {
        auto body = Reg(*select_limit);
        clauses.push_back(fmt.Concat({fmt.Text("limit "), body}));
    }
    if (select_offset) {
        auto body = Reg(*select_offset);
        clauses.push_back(fmt.Concat({fmt.Text("offset "), body}));
    }

    if (clauses.empty()) return FormatUnimplemented(node);
    auto clause_policy = config.mode == buffers::formatting::FormattingMode::INLINE || clauses.size() == 1
                             ? FormattingJoinPolicy::BreakAllOrNone
                             : FormattingJoinPolicy::ForceBreak;
    return fmt.Join(clauses, fmt.Text(" "), fmt.Break(), clause_policy);
}

FmtReg Formatter::FormatCreate(size_t node_id) {
    const auto& node = ast[node_id];
    const auto& state = node_states[node_id];
    if (!state.is_statement_root) return FormatUnimplemented(node);

    auto [name, elements, if_not_exists, temp, on_commit] =
        GetAttributes<AttributeKey::SQL_CREATE_TABLE_NAME, AttributeKey::SQL_CREATE_TABLE_ELEMENTS,
                      AttributeKey::SQL_CREATE_TABLE_IF_NOT_EXISTS, AttributeKey::SQL_CREATE_TABLE_TEMP,
                      AttributeKey::SQL_CREATE_TABLE_ON_COMMIT>(node);

    if (!name || !elements) return FormatUnimplemented(node);
    if (temp || on_commit) return FormatUnimplemented(node);

    std::vector<FmtReg> header_parts;
    header_parts.reserve(2);
    header_parts.push_back(fmt.Text("create table "));
    if (if_not_exists) {
        header_parts.push_back(fmt.Text("if not exists "));
    }
    header_parts.push_back(Reg(*name));
    auto header = fmt.Concat(std::move(header_parts));

    FmtReg table_elements = fmt.Empty();
    if (elements->children_count() > 0) {
        std::vector<FmtReg> parts;
        parts.reserve(elements->children_count());
        auto begin = elements->children_begin_or_value();
        for (size_t i = 0; i < elements->children_count(); ++i) {
            const auto& element = ast[begin + i];
            auto reg = Reg(element);
            if (reg == 0) {
                return FormatUnimplemented(node);
            }
            parts.push_back(reg);
        }
        table_elements = fmt.Join(parts, fmt.Text(", "), fmt.Concat({fmt.Text(","), fmt.Break()}));
    }

    auto element_block = elements->children_count() > 0 ? fmt.Parenthesized(table_elements) : fmt.Text("()");
    auto statement = fmt.Concat({header, fmt.Text(" "), element_block});
    return statement;
}

FmtReg Formatter::FormatNode(size_t node_id) {
    const auto& node = ast[node_id];
    switch (node.node_type()) {
        case NodeType::ARRAY:
            return FormatArray(node);
        case NodeType::OBJECT_SQL_SELECT:
            return FormatSelect(node_id);
        case NodeType::OBJECT_SQL_CREATE:
            return FormatCreate(node_id);
        case NodeType::OBJECT_SQL_TABLEREF:
            return FormatTableRef(node);
        case NodeType::OBJECT_SQL_ORDER:
            return FormatOrder(node);
        case NodeType::ENUM_SQL_ORDER_DIRECTION:
            return FormatOrderDirection(node);
        case NodeType::ENUM_SQL_ORDER_NULL_RULE:
            return FormatOrderNullRule(node);
        case NodeType::OBJECT_SQL_TYPENAME:
            return FormatTypeName(node);
        case NodeType::OBJECT_SQL_NUMERIC_TYPE:
            return FormatNumericType(node);
        case NodeType::ENUM_SQL_NUMERIC_TYPE:
            return FormatNumericTypeBase(node);
        case NodeType::OBJECT_SQL_CHARACTER_TYPE:
            return FormatCharacterType(node);
        case NodeType::ENUM_SQL_CHARACTER_TYPE:
            return FormatCharacterTypeBase(node);
        case NodeType::OBJECT_SQL_GENERIC_TYPE:
            return FormatGenericType(node);
        case NodeType::OBJECT_SQL_COLUMN_REF:
            return FormatColumnRef(node);
        case NodeType::OBJECT_SQL_SELECT_EXPRESSION:
            return FormatSelectExpression(node);
        case NodeType::OBJECT_SQL_RESULT_TARGET:
            return FormatResultTarget(node);
        case NodeType::OBJECT_SQL_COLUMN_DEF:
            return FormatColumnDef(node);
        case NodeType::ENUM_SQL_TABLE_CONSTRAINT:
            return FormatTableConstraintType(node);
        case NodeType::OBJECT_SQL_TABLE_CONSTRAINT:
            return FormatTableConstraint(node);
        case NodeType::ENUM_SQL_KEY_MATCH:
            return FormatKeyMatch(node);
        case NodeType::ENUM_SQL_KEY_ACTION_COMMAND:
            return FormatKeyActionCommand(node);
        case NodeType::ENUM_SQL_KEY_ACTION_TRIGGER:
            return FormatKeyActionTrigger(node);
        case NodeType::OBJECT_SQL_KEY_ACTION:
            return FormatKeyAction(node);
        case NodeType::ENUM_SQL_COLUMN_CONSTRAINT:
            return FormatColumnConstraintType(node);
        case NodeType::OBJECT_SQL_COLUMN_CONSTRAINT:
            return FormatColumnConstraint(node);
        case NodeType::ENUM_SQL_CONSTRAINT_ATTRIBUTE:
            return FormatConstraintAttribute(node);
        case NodeType::OBJECT_SQL_GENERIC_OPTION:
            return FormatGenericOption(node);
        case NodeType::OBJECT_SQL_FUNCTION_EXPRESSION:
            return FormatFunctionExpression(node);
        case NodeType::OBJECT_SQL_FUNCTION_ARG:
            return FormatFunctionArg(node);
        case NodeType::ENUM_SQL_EXPRESSION_OPERATOR:
            return FormatExpressionOperatorType(node);
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
        output += ';';
        if (i + 1 < parsed.statements.size()) {
            output += '\n';
        }
    }
    return output;
}

std::string Formatter::Format(const buffers::formatting::FormattingConfigT& config) {
    this->config = config;
    fmt.Reset();
    fmt.SetConfig(config);
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
