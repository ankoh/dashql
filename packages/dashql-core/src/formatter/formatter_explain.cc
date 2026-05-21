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
        std::vector<FmtReg> opt_parts;
        opt_parts.reserve(options->children_count());
        auto begin = options->children_begin_or_value();
        for (size_t i = 0; i < options->children_count(); ++i) {
            auto reg = Reg(ast[begin + i]);
            if (reg == 0) return FormatUnimplemented(node);
            opt_parts.push_back(reg);
        }
        auto opt_list = fmt.Join(opt_parts, fmt.Text(", "), fmt.Text(", "));
        auto header = fmt.Concat({fmt.Text("explain "), fmt.Parenthesized(opt_list)});
        std::array<FmtReg, 2> clauses{header, stmt_reg};
        return fmt.Join(clauses, fmt.Text(" "), fmt.Break(), FormattingJoinPolicy::ForceBreak);
    }

    return fmt.Concat({fmt.Text("explain "), stmt_reg});
}

}  // namespace dashql
