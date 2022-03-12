#include "dashql/analyzer/sql_type.h"

#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "arrow/visitor_inline.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/proto_generated.h"

namespace dashql {

bool SQLType::TypesEqual(const std::unique_ptr<proto::sql::SQLTypeT>& l,
                         const std::unique_ptr<proto::sql::SQLTypeT>& r) {
    // Any null?
    // Only equal if both are null.
    if (l == nullptr || r == nullptr) {
        return l == nullptr && r == nullptr;
    }

    bool equal = l->type_id == r->type_id && l->is_nullable == r->is_nullable;
    switch (l->type_id) {
        case proto::sql::SQLTypeID::DECIMAL:
            return equal && l->decimal_width == r->decimal_width && l->decimal_scale == r->decimal_scale;
        case proto::sql::SQLTypeID::LIST:
            return equal && l->list_size == r->list_size && TypesEqual(l->value_type, r->value_type);
        case proto::sql::SQLTypeID::STRUCT: {
            if (!equal || l->field_names != r->field_names || l->field_types.size() != r->field_types.size()) {
                return false;
            }
            for (auto i = 0; i < l->field_types.size(); ++i) {
                if (!TypesEqual(l->field_types[i], r->field_types[i])) {
                    return false;
                }
            }
            return true;
        }
        default:
            return equal;
    }
}

// <node key="SQL_TYPENAME_ARRAY">
//     <node loc="32..35" text="[2]" />
// </node>
// <node key="SQL_TYPENAME_TYPE" type="OBJECT_SQL_GENERIC_TYPE" loc="28..32" text="DATE">
//     <node key="SQL_GENERIC_TYPE_NAME" loc="28..32" text="DATE" />
// </node>

/// Read a sql type
arrow::Result<std::unique_ptr<SQLType>> SQLType::ReadFrom(ProgramInstance& instance, size_t node_id) {
    constexpr size_t SX_POS = 0;
    constexpr size_t SX_POS_ROW = 1;

    // clang-format off
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_SQL_TYPENAME);
    // clang-format on

    return nullptr;
}

}  // namespace dashql
