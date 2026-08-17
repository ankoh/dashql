#include "dashql/formatter/formatter.h"

#include "dashql/formatter/formatting_program.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;
using OnCommitOption = buffers::parser::OnCommitOption;
using TempType = buffers::parser::TempType;

FmtReg Formatter::FormatTempType(const buffers::parser::Node& node) {
    auto type = static_cast<TempType>(node.children_begin_or_value());
    switch (type) {
        case TempType::DEFAULT:
        case TempType::LOCAL:
            return fmt.Text("temporary");
        case TempType::GLOBAL:
            return fmt.Text("global temporary");
        case TempType::UNLOGGED:
            return fmt.Text("unlogged");
        case TempType::NONE:
            return fmt.Empty();
    }
    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatOnCommitOption(const buffers::parser::Node& node) {
    auto option = static_cast<OnCommitOption>(node.children_begin_or_value());
    switch (option) {
        case OnCommitOption::DROP:
            return fmt.Text("on commit drop");
        case OnCommitOption::DELETE_ROWS:
            return fmt.Text("on commit delete rows");
        case OnCommitOption::PRESERVE_ROWS:
            return fmt.Text("on commit preserve rows");
        case OnCommitOption::NOOP:
            return fmt.Empty();
    }
    return FormatUnimplemented(node);
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

    std::vector<FmtReg> header_parts;
    header_parts.reserve(4);
    header_parts.push_back(fmt.Text("create "));
    if (temp) {
        header_parts.push_back(Reg(*temp));
        header_parts.push_back(fmt.Text(" "));
    }
    header_parts.push_back(fmt.Text("table "));
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
    if (on_commit) {
        statement = fmt.Concat({statement, fmt.Text(" "), Reg(*on_commit)});
    }
    return statement;
}

FmtReg Formatter::FormatCreateAs(const buffers::parser::Node& node) {
    auto [name, columns, if_not_exists, temp, statement, with_data, on_commit] =
        GetAttributes<AttributeKey::SQL_CREATE_AS_NAME, AttributeKey::SQL_CREATE_AS_COLUMNS,
                      AttributeKey::SQL_CREATE_AS_IF_NOT_EXISTS, AttributeKey::SQL_CREATE_AS_TEMP,
                      AttributeKey::SQL_CREATE_AS_STATEMENT, AttributeKey::SQL_CREATE_AS_WITH_DATA,
                      AttributeKey::SQL_CREATE_AS_ON_COMMIT>(node);
    if (!name || !statement) return FormatUnimplemented(node);

    std::vector<FmtReg> parts{fmt.Text("create ")};
    if (temp) {
        parts.push_back(Reg(*temp));
        parts.push_back(fmt.Text(" "));
    }
    parts.push_back(fmt.Text("table "));
    if (if_not_exists) parts.push_back(fmt.Text("if not exists "));
    parts.push_back(Reg(*name));
    if (columns && columns->children_count() > 0) {
        parts.push_back(fmt.Parenthesized(Reg(*columns)));
    }
    if (on_commit) {
        parts.push_back(fmt.Text(" "));
        parts.push_back(Reg(*on_commit));
    }
    parts.push_back(fmt.Text(" as "));
    parts.push_back(Reg(*statement));
    if (with_data) {
        bool include_data = with_data->node_type() == NodeType::BOOL && with_data->children_begin_or_value() != 0;
        parts.push_back(fmt.Text(include_data ? " with data" : " with no data"));
    }
    return fmt.Concat(std::move(parts));
}

FmtReg Formatter::FormatView(const buffers::parser::Node& node) {
    auto [name, columns, temp, statement] =
        GetAttributes<AttributeKey::SQL_VIEW_NAME, AttributeKey::SQL_VIEW_COLUMNS, AttributeKey::SQL_VIEW_TEMP,
                      AttributeKey::SQL_VIEW_STATEMENT>(node);
    if (!name || !statement) return FormatUnimplemented(node);

    std::vector<FmtReg> parts{fmt.Text("create ")};
    if (temp) {
        parts.push_back(Reg(*temp));
        parts.push_back(fmt.Text(" "));
    }
    parts.push_back(fmt.Text("view "));
    parts.push_back(Reg(*name));
    if (columns && columns->children_count() > 0) {
        parts.push_back(fmt.Parenthesized(Reg(*columns)));
    }
    parts.push_back(fmt.Text(" as "));
    parts.push_back(Reg(*statement));
    return fmt.Concat(std::move(parts));
}

FmtReg Formatter::FormatFunctionParam(const buffers::parser::Node& node) {
    auto [name, type] =
        GetAttributes<AttributeKey::SQL_FUNCTION_PARAM_NAME, AttributeKey::SQL_FUNCTION_PARAM_TYPE>(node);
    if (!name || !type) return FormatUnimplemented(node);
    return fmt.Concat({Reg(*name), fmt.Text(" "), Reg(*type)});
}

FmtReg Formatter::FormatCreateFunction(const buffers::parser::Node& node) {
    auto [name, params, returns, aggregate] =
        GetAttributes<AttributeKey::SQL_CREATE_FUNCTION_NAME, AttributeKey::SQL_CREATE_FUNCTION_PARAMS,
                      AttributeKey::SQL_CREATE_FUNCTION_RETURNS, AttributeKey::SQL_CREATE_FUNCTION_IS_AGGREGATE>(node);
    if (!name || !returns) return FormatUnimplemented(node);

    auto kind = aggregate ? "create aggregate " : "create function ";
    auto params_reg = params ? Reg(*params) : fmt.Empty();
    return fmt.Concat({fmt.Text(kind), Reg(*name), fmt.Parenthesized(params_reg), fmt.Text(" returns "),
                       Reg(*returns)});
}

FmtReg Formatter::FormatDrop(const buffers::parser::Node& node, bool table) {
    auto [name, if_exists] =
        GetAttributes<AttributeKey::SQL_DROP_NAME, AttributeKey::SQL_DROP_IF_EXISTS>(node);
    if (!name) return FormatUnimplemented(node);

    std::string_view object = table ? "table " : "view ";
    return fmt.Concat({fmt.Text("drop "), fmt.Text(object), if_exists ? fmt.Text("if exists ") : fmt.Empty(),
                       Reg(*name)});
}

FmtReg Formatter::FormatAttachDatabaseOption(const buffers::parser::Node& node) {
    auto [key, value] =
        GetAttributes<AttributeKey::SQL_GENERIC_OPTION_KEY, AttributeKey::SQL_GENERIC_OPTION_VALUE>(node);
    if (!key || !value) return FormatUnimplemented(node);
    return fmt.Concat({Reg(*key), fmt.Text(" = "), Reg(*value)});
}

FmtReg Formatter::FormatAttachDatabase(const buffers::parser::Node& node) {
    auto [path, alias, local, options] =
        GetAttributes<AttributeKey::SQL_ATTACH_DATABASE_PATH, AttributeKey::SQL_ATTACH_DATABASE_ALIAS,
                      AttributeKey::SQL_ATTACH_DATABASE_LOCAL, AttributeKey::SQL_ATTACH_DATABASE_OPTIONS>(node);
    if (!path || !alias) return FormatUnimplemented(node);

    std::vector<FmtReg> parts{fmt.Text(local ? "attach local database " : "attach database "), Reg(*path),
                              fmt.Text(" as "), Reg(*alias)};
    if (options) {
        parts.push_back(fmt.Text(" with "));
        parts.push_back(fmt.Parenthesized(Reg(*options)));
    }
    return fmt.Concat(std::move(parts));
}

FmtReg Formatter::FormatVarargField(const buffers::parser::Node& node) {
    auto [key, value] =
        GetAttributes<AttributeKey::EXT_VARARG_FIELD_KEY, AttributeKey::EXT_VARARG_FIELD_VALUE>(node);
    if (!key || !value) return FormatUnimplemented(node);
    return fmt.Concat({Reg(*key), fmt.Text(" = "), Reg(*value)});
}

FmtReg Formatter::FormatSet(const buffers::parser::Node& node) {
    auto [varargs] = GetAttributes<AttributeKey::EXT_SET_VARARGS>(node);
    if (!varargs) return FormatUnimplemented(node);
    return fmt.Concat({fmt.Text("set "), Reg(*varargs)});
}

}  // namespace dashql
