#include "dashql/analyzer/arrow_type.h"

#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "arrow/visitor_inline.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/proto_generated.h"

namespace dashql {

constexpr size_t SX_TYPENAME_TYPE = 0;
constexpr size_t SX_TYPENAME_ARRAY = 1;
constexpr size_t SX_TYPENAME_SETOF = 2;

constexpr size_t SX_NUMERIC_TYPE = 3;
constexpr size_t SX_NUMERIC_TYPE_MODS = 4;
constexpr size_t SX_BIT_TYPE_VARYING = 5;
constexpr size_t SX_BIT_TYPE_LENGTH = 6;
constexpr size_t SX_CHARACTER_TYPE = 7;
constexpr size_t SX_CHARACTER_LENGTH = 8;

bool TypesEqual(const std::shared_ptr<arrow::DataType>& l, const std::shared_ptr<arrow::DataType>& r) {
    if (l == nullptr || r == nullptr) {
        return l == nullptr && r == nullptr;
    }
    return l->Equals(*r);
}

/// Read a sql type
arrow::Result<std::shared_ptr<arrow::DataType>> ReadTypeFrom(ProgramInstance& instance, size_t node_id) {
    // clang-format off
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_SQL_TYPENAME)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::SQL_TYPENAME_ARRAY, SX_TYPENAME_ARRAY),
            sxm::Attribute(sx::AttributeKey::SQL_TYPENAME_SETOF, SX_TYPENAME_SETOF),
            sxm::Attribute(sx::AttributeKey::SQL_TYPENAME_TYPE)
                .SelectByType({
                    sxm::Element(SX_NUMERIC_TYPE)
                        .MatchEnum(sx::NodeType::ENUM_SQL_NUMERIC_TYPE),
                    sxm::Element()
                        .MatchObject(sx::NodeType::OBJECT_SQL_NUMERIC_TYPE)
                        .MatchChildren({
                            sxm::Attribute(sx::AttributeKey::SQL_NUMERIC_TYPE, SX_NUMERIC_TYPE)
                                .MatchEnum(sx::NodeType::ENUM_SQL_NUMERIC_TYPE),
                            sxm::Attribute(sx::AttributeKey::SQL_NUMERIC_TYPE_MODIFIERS, SX_NUMERIC_TYPE_MODS)
                                .MatchArray()
                        }),
                    sxm::Element()
                        .MatchObject(sx::NodeType::OBJECT_SQL_BIT_TYPE)
                        .MatchChildren({
                            sxm::Attribute(sx::AttributeKey::SQL_BIT_TYPE_LENGTH, SX_BIT_TYPE_LENGTH),
                            sxm::Attribute(sx::AttributeKey::SQL_BIT_TYPE_VARYING, SX_BIT_TYPE_VARYING)
                                .MatchBool(),
                        }),
                    sxm::Element()
                        .MatchObject(sx::NodeType::OBJECT_SQL_CHARACTER_TYPE)
                        .MatchChildren({
                            sxm::Attribute(sx::AttributeKey::SQL_CHARACTER_TYPE, SX_CHARACTER_TYPE)
                                .MatchEnum(sx::NodeType::ENUM_SQL_CHARACTER_TYPE),
                            sxm::Attribute(sx::AttributeKey::SQL_CHARACTER_TYPE_LENGTH, SX_CHARACTER_LENGTH)
                                .MatchString(),
                        }),
                    sxm::Element()
                        .MatchObject(sx::NodeType::OBJECT_SQL_TIMESTAMP_TYPE)
                        .MatchChildren({
                            sxm::Attribute(sx::AttributeKey::SQL_TIME_TYPE_PRECISION)
                                .MatchString(),
                            sxm::Attribute(sx::AttributeKey::SQL_TIME_TYPE_WITH_TIMEZONE)
                                .MatchBool(),
                        }),
                    sxm::Element()
                        .MatchObject(sx::NodeType::OBJECT_SQL_INTERVAL_TYPE)
                        .MatchChildren({
                            sxm::Attribute(sx::AttributeKey::SQL_INTERVAL_PRECISION)
                                .MatchString(),
                            sxm::Attribute(sx::AttributeKey::SQL_INTERVAL_TYPE)
                                .MatchEnum(sx::NodeType::ENUM_SQL_INTERVAL_TYPE),
                        }),
                })
        });
    // clang-format on

    return nullptr;
}

/// Pack a sql type
flatbuffers::Offset<proto::sql::SQLType> PackType(flatbuffers::FlatBufferBuilder& builder, const arrow::DataType& r) {
    proto::sql::SQLTypeBuilder t{builder};
    switch (r.id()) {
        case arrow::Type::type::BOOL:
            t.add_type_id(dashql::proto::sql::SQLTypeID::BOOLEAN);
            break;
        case arrow::Type::type::DATE32:
        case arrow::Type::type::DATE64:
            t.add_type_id(dashql::proto::sql::SQLTypeID::DATE);
            break;
        case arrow::Type::type::INT8:
            t.add_type_id(dashql::proto::sql::SQLTypeID::TINYINT);
            break;
        case arrow::Type::type::INT16:
            t.add_type_id(dashql::proto::sql::SQLTypeID::SMALLINT);
            break;
        case arrow::Type::type::INT32:
            t.add_type_id(dashql::proto::sql::SQLTypeID::INTEGER);
            break;
        case arrow::Type::type::INT64:
            t.add_type_id(dashql::proto::sql::SQLTypeID::BIGINT);
            break;
        case arrow::Type::type::STRING:
            t.add_type_id(dashql::proto::sql::SQLTypeID::VARCHAR);
            break;
        case arrow::Type::type::DOUBLE:
            t.add_type_id(dashql::proto::sql::SQLTypeID::DOUBLE);
            break;
        case arrow::Type::type::HALF_FLOAT:
        case arrow::Type::type::FLOAT:
            t.add_type_id(dashql::proto::sql::SQLTypeID::FLOAT);
            break;
        default:
            t.add_type_id(dashql::proto::sql::SQLTypeID::INVALID);
            break;
    }
    return t.Finish();
}

/// Unpack a type
std::shared_ptr<arrow::DataType> UnpackType(proto::sql::SQLTypeT& type) {
    switch (type.type_id) {
        case proto::sql::SQLTypeID::INVALID:
        case proto::sql::SQLTypeID::SQLNULL:
        case proto::sql::SQLTypeID::UNKNOWN:
        case proto::sql::SQLTypeID::ANY:
            return arrow::null();
        case proto::sql::SQLTypeID::BIGINT:
            return arrow::int64();
        case proto::sql::SQLTypeID::BLOB:
        case proto::sql::SQLTypeID::BOOLEAN:
            return arrow::boolean();
        case proto::sql::SQLTypeID::VARCHAR:
        case proto::sql::SQLTypeID::CHAR:
            return arrow::utf8();
        case proto::sql::SQLTypeID::DATE:
            return arrow::date32();
        case proto::sql::SQLTypeID::DECIMAL:
        case proto::sql::SQLTypeID::DOUBLE:
            return arrow::float64();
        case proto::sql::SQLTypeID::FLOAT:
            return arrow::float32();
        case proto::sql::SQLTypeID::INTEGER:
            return arrow::int32();
        case proto::sql::SQLTypeID::INTERVAL:
            return arrow::day_time_interval();
        case proto::sql::SQLTypeID::LIST:
        case proto::sql::SQLTypeID::SMALLINT:
            return arrow::int16();
        case proto::sql::SQLTypeID::STRUCT:
        case proto::sql::SQLTypeID::TIME:
            return arrow::time64(arrow::TimeUnit::MILLI);
        case proto::sql::SQLTypeID::TIMESTAMP:
            return arrow::timestamp(arrow::TimeUnit::MILLI);
        case proto::sql::SQLTypeID::TINYINT:
            return arrow::int8();
        default:
            return arrow::null();
    }
}

}  // namespace dashql
