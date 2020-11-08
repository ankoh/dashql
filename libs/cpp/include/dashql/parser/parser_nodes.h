// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_PARSER_NODES_H_
#define INCLUDE_DASHQL_PARSER_PARSER_NODES_H_

#include "dashql/parser/parser_driver.h"

namespace dashql {
namespace parser {

/// Create a constant inline
inline sx::Node AddConst(ParserDriver& driver, sx::Location loc, sxs::AConstType type) {
    return driver.Add(loc, sx::NodeType::SQL_ACONST, {
        sx::AttributeKey::SQL_ACONST_TYPE << driver.RefEnum(loc, type),
    });
}

/// Create indirection
inline sx::Node AddIndirection(ParserDriver& driver, sx::Location loc, sx::Node index) {
    return driver.Add(loc, sx::NodeType::SQL_INDIRECTION, {
        sx::AttributeKey::SQL_INDIRECTION_INDEX << index,
    });
}

/// Create indirection
inline sx::Node AddIndirection(ParserDriver& driver, sx::Location loc, sx::Node lower_bound, sx::Node upper_bound) {
    return driver.Add(loc, sx::NodeType::SQL_INDIRECTION, {
        sx::AttributeKey::SQL_INDIRECTION_LOWER_BOUND << lower_bound,
        sx::AttributeKey::SQL_INDIRECTION_UPPER_BOUND << upper_bound,
    });
}

/// Create relation expression
inline sx::Node AddAlias(ParserDriver& driver, sx::Location loc, sx::Node name, sx::Node columns) {
    return driver.Add(loc, sx::NodeType::SQL_ALIAS, {
        sx::AttributeKey::SQL_ALIAS_NAME << name,
        sx::AttributeKey::SQL_ALIAS_COLUMNS << columns,
    });
}

/// Create a temp table name
inline sx::Node AddInto(ParserDriver& driver, sx::Location loc, sx::Node type, sx::Node name) {
    return driver.Add(loc, sx::NodeType::SQL_INTO, {
        sx::AttributeKey::SQL_TEMP_TYPE << type,
        sx::AttributeKey::SQL_TEMP_NAME << name,
    });
}

/// Create a column ref
inline sx::Node AddColumnRef(ParserDriver& driver, sx::Location loc, NodeVector&& path) {
    return driver.Add(loc, sx::NodeType::SQL_COLUMN_REF, {
        sx::AttributeKey::SQL_COLUMN_REF_PATH << driver.Add(loc, move(path)),
    });
}

/// Collect viz attributes
inline NodeVector CollectViz(ParserDriver& driver, sx::Location viz_loc, sxd::VizType viz_type, std::initializer_list<std::reference_wrapper<NodeVector>> attrs) {
    auto type_val = driver.RefEnum(viz_loc, viz_type);
    auto type_attr = sx::AttributeKey::DASHQL_VIZ_TYPE << type_val;
    NodeVector result{type_attr};
    for (auto& as: attrs) {
        for (auto& a: as.get()) {
            result.push_back(a);
        }
    }
    return result;
}

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_PARSER_NODES_H_
