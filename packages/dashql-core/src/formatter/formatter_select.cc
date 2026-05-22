#include "dashql/formatter/formatter.h"

#include "dashql/formatter/formatting_program.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;
using CombineOperation = buffers::parser::CombineOperation;
using CombineModifier = buffers::parser::CombineModifier;

FmtReg Formatter::FormatSelect(size_t node_id) {
    const auto& node = ast[node_id];

    auto [select_all, select_distinct, select_targets, select_into, select_from, select_where, select_groups,
          select_having, select_windows, select_order, select_row_locking, select_with_ctes, select_with_recursive,
          select_offset, select_limit, select_limit_all, select_sample, select_values, combine_operation,
          combine_modifier, combine_input] =
        GetAttributes<AttributeKey::SQL_SELECT_ALL, AttributeKey::SQL_SELECT_DISTINCT, AttributeKey::SQL_SELECT_TARGETS,
                      AttributeKey::SQL_SELECT_INTO, AttributeKey::SQL_SELECT_FROM, AttributeKey::SQL_SELECT_WHERE,
                      AttributeKey::SQL_SELECT_GROUPS, AttributeKey::SQL_SELECT_HAVING,
                      AttributeKey::SQL_SELECT_WINDOWS, AttributeKey::SQL_SELECT_ORDER,
                      AttributeKey::SQL_SELECT_ROW_LOCKING, AttributeKey::SQL_SELECT_WITH_CTES,
                      AttributeKey::SQL_SELECT_WITH_RECURSIVE, AttributeKey::SQL_SELECT_OFFSET,
                      AttributeKey::SQL_SELECT_LIMIT, AttributeKey::SQL_SELECT_LIMIT_ALL,
                      AttributeKey::SQL_SELECT_SAMPLE, AttributeKey::SQL_SELECT_VALUES,
                      AttributeKey::SQL_COMBINE_OPERATION, AttributeKey::SQL_COMBINE_MODIFIER,
                      AttributeKey::SQL_COMBINE_INPUT>(node);

    if (combine_operation && combine_input) {
        auto op = static_cast<CombineOperation>(combine_operation->children_begin_or_value());
        std::string op_text;
        switch (op) {
            case CombineOperation::UNION:
                op_text = "union";
                break;
            case CombineOperation::INTERSECT:
                op_text = "intersect";
                break;
            case CombineOperation::EXCEPT:
                op_text = "except";
                break;
            default:
                return FormatUnimplemented(node);
        }
        if (combine_modifier) {
            auto mod = static_cast<CombineModifier>(combine_modifier->children_begin_or_value());
            switch (mod) {
                case CombineModifier::ALL:
                    op_text += " all";
                    break;
                case CombineModifier::DISTINCT:
                    op_text += " distinct";
                    break;
                default:
                    break;
            }
        }
        auto separator = fmt.Text(" " + op_text + " ");
        auto break_separator = fmt.Concat({fmt.Break(), fmt.Text(op_text), fmt.Break()});
        auto children = GetArrayStates(*combine_input);
        std::vector<FmtReg> inputs;
        inputs.reserve(children.size());
        for (auto& child : children) {
            if (child.reg == 0) return FormatUnimplemented(node);
            inputs.push_back(child.reg);
        }
        return fmt.Join(inputs, separator, break_separator, FormattingJoinPolicy::BreakAllOrNone);
    }

    if (select_into || select_windows || select_row_locking || select_with_ctes || select_with_recursive ||
        select_sample || select_values || select_limit_all) {
        return FormatUnimplemented(node);
    }

    std::vector<FmtReg> clauses;
    clauses.reserve(8);
    if (select_targets) {
        auto body = Reg(*select_targets);
        if (select_distinct && select_distinct->node_type() == NodeType::ARRAY) {
            if (select_distinct->children_count() > 0) {
                auto on_cols = Reg(*select_distinct);
                clauses.push_back(
                    fmt.Concat({fmt.Text("select distinct on "), fmt.Parenthesized(on_cols), fmt.Text(" "), body}));
            } else {
                clauses.push_back(fmt.Concat({fmt.Text("select distinct "), body}));
            }
        } else {
            clauses.push_back(fmt.Concat({fmt.Text("select "), body}));
        }
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
    auto clause_policy = config.mode == buffers::formatting::FormattingMode::PRETTY
                             ? FormattingJoinPolicy::ForceBreak
                             : FormattingJoinPolicy::BreakAllOrNone;
    return fmt.Join(clauses, fmt.Text(" "), fmt.Break(), clause_policy);
}

}  // namespace dashql
