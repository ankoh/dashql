#include "dashql/formatter/formatter.h"

#include "dashql/formatter/formatting_program.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;

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

}  // namespace dashql
