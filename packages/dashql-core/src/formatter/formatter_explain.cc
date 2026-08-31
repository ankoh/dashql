#include "dashql/formatter/formatter.h"

#include "dashql/formatter/formatting_program.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;

FmtReg Formatter::FormatExplain(size_t node_id) {
    const auto& node = ast[node_id];
    auto [statement, options] =
        GetAttributes<AttributeKey::EXT_EXPLAIN_STATEMENT, AttributeKey::EXT_EXPLAIN_OPTIONS>(node);
    if (!statement) return FormatUnimplemented(node);

    auto stmt_reg = Reg(*statement);
    if (stmt_reg == 0) return FormatUnimplemented(node);

    if (options && options->children_count() > 0) {
        auto options_reg = Reg(*options);
        if (options_reg == 0) return FormatUnimplemented(node);
        auto header = fmt.Concat({fmt.Text("explain "), fmt.Parenthesized(options_reg)});
        std::array<FmtReg, 2> clauses{header, stmt_reg};
        return fmt.Join(clauses, fmt.Text(" "), fmt.Break(), FormattingJoinPolicy::ForceBreak);
    }

    return fmt.Concat({fmt.Text("explain "), stmt_reg});
}

FmtReg Formatter::FormatExplainExpressions(const buffers::parser::Node& node) {
    auto [expressions] = GetAttributes<AttributeKey::EXT_EXPLAIN_EXPRESSIONS>(node);
    if (!expressions) return FormatUnimplemented(node);

    auto expressions_reg = Reg(*expressions);
    if (expressions_reg == 0) return FormatUnimplemented(node);
    return fmt.Concat({fmt.Text("expressions "), fmt.Parenthesized(expressions_reg)});
}

}  // namespace dashql
