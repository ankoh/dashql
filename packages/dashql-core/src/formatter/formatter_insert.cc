#include "dashql/formatter/formatter.h"

#include "dashql/formatter/formatting_program.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;

FmtReg Formatter::FormatInsert(const buffers::parser::Node& node) {
    auto [target, columns, source, default_values, returning, with_ctes, with_recursive] =
        GetAttributes<AttributeKey::SQL_INSERT_TARGET, AttributeKey::SQL_INSERT_COLUMNS,
                      AttributeKey::SQL_INSERT_SOURCE, AttributeKey::SQL_INSERT_DEFAULT_VALUES,
                      AttributeKey::SQL_INSERT_RETURNING, AttributeKey::SQL_SELECT_WITH_CTES,
                      AttributeKey::SQL_SELECT_WITH_RECURSIVE>(node);
    if (!target || (source == nullptr) == (default_values == nullptr)) return FormatUnimplemented(node);

    auto target_reg = Reg(*target);
    if (target_reg == 0) return FormatUnimplemented(*target);

    std::vector<FmtReg> clauses;
    FmtReg header = fmt.Concat({fmt.Text("insert into "), target_reg});
    if (columns && columns->node_type() == NodeType::ARRAY && columns->children_count() > 0) {
        auto columns_reg = Reg(*columns);
        if (columns_reg == 0) return FormatUnimplemented(*columns);
        header = fmt.Concat({header, fmt.Parenthesized(columns_reg)});
    }
    clauses.push_back(header);

    if (source) {
        auto source_reg = Reg(*source);
        if (source_reg == 0) return FormatUnimplemented(*source);
        clauses.push_back(source_reg);
    } else {
        clauses.push_back(fmt.Text("default values"));
    }

    if (returning && returning->node_type() == NodeType::ARRAY && returning->children_count() > 0) {
        auto returning_reg = Reg(*returning);
        if (returning_reg == 0) return FormatUnimplemented(*returning);
        clauses.push_back(fmt.Concat({fmt.Text("returning "), returning_reg}));
    }

    auto policy = config.mode == buffers::formatting::FormattingMode::PRETTY
                      ? FormattingJoinPolicy::ForceBreak
                      : FormattingJoinPolicy::BreakAllOrNone;
    auto query = fmt.Join(clauses, fmt.Text(" "), fmt.Break(), policy);

    if (with_ctes) {
        auto ctes_reg = Reg(*with_ctes);
        if (ctes_reg == 0) return FormatUnimplemented(*with_ctes);
        auto with_clause = fmt.Concat(
            {fmt.Text(with_recursive ? "with recursive " : "with "), ctes_reg});
        query = fmt.Join(std::vector<FmtReg>{with_clause, query}, fmt.Text(" "), fmt.Break(), policy);
    }
    return query;
}

}  // namespace dashql
