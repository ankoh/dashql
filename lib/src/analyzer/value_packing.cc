#include "dashql/analyzer/value_packing.h"

#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "arrow/visitor_inline.h"
#include "dashql/proto_generated.h"

namespace dashql {

/// Pack a value
arrow::Result<flatbuffers::Offset<proto::sql::SQLValue>> PackValue(flatbuffers::FlatBufferBuilder& builder,
                                                                   const arrow::Scalar& scalar) {
    std::optional<flatbuffers::Offset<flatbuffers::String>> str = std::nullopt;
    if (scalar.type->id() == arrow::Type::STRING) {
        str = builder.CreateString(scalar.ToString());
    }
    proto::sql::SQLType logical_type;
    proto::sql::SQLValueBuilder v{builder};
    v.add_is_null(!scalar.is_valid);
    switch (scalar.type->id()) {
        case arrow::Type::INT64:
            logical_type = proto::sql::SQLType(proto::sql::SQLTypeID::BIGINT, 0, 0);
            v.add_logical_type(&logical_type);
            v.add_physical_type(proto::sql::PhysicalType::I64);
            v.add_data_i64(reinterpret_cast<const arrow::Int64Scalar&>(scalar).value);
            break;
        case arrow::Type::DOUBLE:
            logical_type = proto::sql::SQLType(proto::sql::SQLTypeID::DOUBLE, 0, 0);
            v.add_logical_type(&logical_type);
            v.add_physical_type(proto::sql::PhysicalType::F64);
            v.add_data_f64(reinterpret_cast<const arrow::DoubleScalar&>(scalar).value);
            break;
        case arrow::Type::STRING:
            logical_type = proto::sql::SQLType(proto::sql::SQLTypeID::VARCHAR, 0, 0);
            v.add_logical_type(&logical_type);
            v.add_physical_type(proto::sql::PhysicalType::STRING);
            v.add_data_str(str.value());
            break;
        case arrow::Type::NA:
            logical_type = proto::sql::SQLType(proto::sql::SQLTypeID::SQLNULL, 0, 0);
            v.add_logical_type(&logical_type);
            v.add_physical_type(proto::sql::PhysicalType::NONE);
            break;
        default:
            return arrow::Status::Invalid("Value packing not implemented for type: ", scalar.type->ToString());
    }
    return v.Finish();
}
/// Unpack a value
arrow::Result<std::shared_ptr<arrow::Scalar>> UnPackValue(const proto::sql::SQLValue& value) {
#define EXPECT_PHYSICAL(TYPE) \
    if (value.physical_type() != TYPE) return arrow::Status::Invalid("unexpected physical type");

    switch (value.logical_type()->type_id()) {
        case proto::sql::SQLTypeID::BIGINT:
            EXPECT_PHYSICAL(proto::sql::PhysicalType::I64);
            return arrow::MakeScalar(arrow::int64(), value.data_i64());
        case proto::sql::SQLTypeID::DOUBLE:
            EXPECT_PHYSICAL(proto::sql::PhysicalType::F64);
            return arrow::MakeScalar(arrow::float64(), value.data_f64());
        case proto::sql::SQLTypeID::VARCHAR:
            EXPECT_PHYSICAL(proto::sql::PhysicalType::STRING);
            return arrow::MakeScalar(arrow::utf8(), value.data_str()->c_str());
        case proto::sql::SQLTypeID::SQLNULL:
            EXPECT_PHYSICAL(proto::sql::PhysicalType::STRING);
            return arrow::MakeNullScalar(arrow::null());
        default:
            return arrow::Status::Invalid("Value unpacking not implemented for type");
    }
}

}  // namespace dashql
