#include "dashql/formatter/formatter.h"

#include "dashql/formatter/formatting_program.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;

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
    auto clause_policy = config.mode == buffers::formatting::FormattingMode::PRETTY
                             ? FormattingJoinPolicy::ForceBreak
                             : FormattingJoinPolicy::BreakAllOrNone;
    return fmt.Join(clauses, fmt.Text(" "), fmt.Break(), clause_policy);
}

}  // namespace dashql
