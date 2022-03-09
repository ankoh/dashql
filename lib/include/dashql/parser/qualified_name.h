// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_QUALIFIED_NAME_H_
#define INCLUDE_DASHQL_PARSER_QUALIFIED_NAME_H_

#include <string_view>

#include "dashql/proto_generated.h"
#include "nonstd/span.h"

namespace dashql {
namespace parser {

struct QualifiedNameView {
    /// The catalog
    std::string_view catalog = {};
    /// The schema
    std::string_view schema = {};
    /// The relation
    std::string_view relation = {};
    /// The index
    std::string_view index_value = {};

    /// Create a string for a qualified name
    std::string ToString() const;
    /// Create a string for a pretty name
    std::string ToPrettyString() const;
    /// Without indirection
    QualifiedNameView WithoutIndex() const {
        return {
            .catalog = catalog,
            .schema = schema,
            .relation = relation,
            .index_value = {},
        };
    }
    /// Without indirection
    QualifiedNameView WithDefaultSchema(std::string_view global) const {
        return {
            .catalog = catalog,
            .schema = schema.empty() ? global : schema,
            .relation = relation,
            .index_value = index_value,
        };
    }
    /// Equality operator
    bool operator==(const QualifiedNameView& rhs) const {
        return (catalog == rhs.catalog) && (schema == rhs.schema) && (relation == rhs.relation) &&
               (index_value == rhs.index_value);
    }
    /// Hasher
    struct Hasher {
        static inline void hash_combine(std::size_t& seed, std::string_view v) {
            std::hash<std::string_view> hasher;
            seed ^= hasher(v) + 0x9e3779b9 + (seed << 6) + (seed >> 2);
        }
        std::size_t operator()(const QualifiedNameView& qn) const noexcept {
            size_t v = 0;
            hash_combine(v, qn.relation);
            hash_combine(v, qn.catalog);
            hash_combine(v, qn.schema);
            hash_combine(v, qn.index_value);
            return v;
        }
    };

    /// Read from a qualified name
    static QualifiedNameView ReadFrom(nonstd::span<proto::syntax::Node> nodes, std::string_view text, size_t root_id);
};

}  // namespace parser
}  // namespace dashql

#endif
