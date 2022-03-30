#include "dashql/analyzer/arrow_scalar.h"

#include <sstream>
#include <type_traits>

#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "arrow/visitor_inline.h"
#include "dashql/analyzer/arrow_type.h"
#include "dashql/proto_generated.h"

namespace dashql {

flatbuffers::Offset<proto::sql::SQLValue> PackScalar(flatbuffers::FlatBufferBuilder& builder,
                                                     const arrow::Scalar& scalar) {
    proto::sql::SQLValueT value;
    switch (scalar.type->id()) {
#define X(TYPE, SCALAR, VAR, GETTER, DST)                       \
    case TYPE: {                                                \
        auto& s = reinterpret_cast<const SCALAR&>(scalar);      \
        static_assert(std::is_same_v<VAR, decltype(s.GETTER)>); \
        value.DST = s.GETTER;                                   \
    }
        // clang-format off
        X(arrow::Type::BOOL, arrow::BooleanScalar, bool, value, data_i64)
        X(arrow::Type::DATE32, arrow::Date32Scalar, int32_t, value, data_i64)
        X(arrow::Type::INT8, arrow::Int8Scalar, int8_t, value, data_i64)
        X(arrow::Type::INT16, arrow::Int16Scalar, int16_t, value, data_i64)
        X(arrow::Type::INT32, arrow::Int32Scalar, int32_t, value, data_i64)
        X(arrow::Type::INT64, arrow::Int64Scalar, int64_t, value, data_i64)
        X(arrow::Type::FLOAT, arrow::FloatScalar, float, value, data_f64)
        X(arrow::Type::DOUBLE, arrow::DoubleScalar, double, value, data_f64)
        X(arrow::Type::TIME64, arrow::Time64Scalar, int64_t, value, data_i64)
        X(arrow::Type::TIMESTAMP, arrow::TimestampScalar, int64_t, value, data_i64)
        // clang-format on
#undef X
        case arrow::Type::STRING: {
            auto& s = reinterpret_cast<const arrow::StringScalar&>(scalar);
            auto& v = s.value;
            value.data_str = std::string{reinterpret_cast<const char*>(v->data()), static_cast<size_t>(v->size())};
        }
        case arrow::Type::INTERVAL_DAY_TIME: {
            auto& s = reinterpret_cast<const arrow::DayTimeIntervalScalar&>(scalar);
            auto& v = s.value;
            value.data_interval = std::make_unique<proto::sql::DayTimeInterval>();
            value.data_interval->mutate_days(v.days);
            value.data_interval->mutate_milliseconds(v.milliseconds);
        }
        case arrow::Type::STRUCT:
        case arrow::Type::LIST:
        default:
            break;
    }
    return proto::sql::SQLValue::Pack(builder, &value);
}

arrow::Result<flatbuffers::Offset<proto::sql::SQLValue>> PackArrowScalar(flatbuffers::FlatBufferBuilder& builder,
                                                                         const arrow::Scalar& scalar) {
    std::optional<flatbuffers::Offset<flatbuffers::String>> str = std::nullopt;
    if (scalar.type->id() == arrow::Type::STRING) {
        str = builder.CreateString(scalar.ToString());
    }
    auto logical = PackType(builder, *scalar.type);
    proto::sql::SQLValueBuilder v{builder};
    v.add_is_null(!scalar.is_valid);
    v.add_logical_type(logical);
    switch (scalar.type->id()) {
        case arrow::Type::INT64:
            v.add_physical_type(proto::sql::PhysicalType::I64);
            v.add_data_i64(reinterpret_cast<const arrow::Int64Scalar&>(scalar).value);
            break;
        case arrow::Type::DOUBLE:
            v.add_physical_type(proto::sql::PhysicalType::F64);
            v.add_data_f64(reinterpret_cast<const arrow::DoubleScalar&>(scalar).value);
            break;
        case arrow::Type::STRING:
            v.add_physical_type(proto::sql::PhysicalType::STRING);
            v.add_data_str(str.value());
            break;
        case arrow::Type::NA:
            v.add_logical_type(logical);
            v.add_physical_type(proto::sql::PhysicalType::NONE);
            break;
        default:
            return arrow::Status::Invalid("Value packing not implemented for type: ", scalar.type->ToString());
    }

    return v.Finish();
}
/// Unpack a value
arrow::Result<std::shared_ptr<arrow::Scalar>> UnpackScalar(const proto::sql::SQLValue& value) {
#define EXPECT_PHYSICAL(TYPE) \
    if (value.physical_type() != TYPE) return arrow::Status::Invalid("unexpected physical type");

    switch (value.logical_type()->type_id()) {
        case proto::sql::SQLTypeID::SMALLINT:
        case proto::sql::SQLTypeID::TINYINT:
        case proto::sql::SQLTypeID::INTEGER:
        case proto::sql::SQLTypeID::BIGINT:
            EXPECT_PHYSICAL(proto::sql::PhysicalType::I64);
            return arrow::MakeScalar(arrow::int64(), value.data_i64());
        case proto::sql::SQLTypeID::FLOAT:
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
#undef EXPECT_PHYSICAL
}

std::string PrintScalar(const arrow::Scalar& scalar) { return scalar.ToString(); }

std::string PrintScalarForScript(const arrow::Scalar& scalar) {
    switch (scalar.type->id()) {
        case arrow::Type::STRING: {
            std::stringstream buffer;
            buffer << "\'";
            buffer << scalar.ToString();
            buffer << "\'";
            return buffer.str();
        }
        default:
            return scalar.ToString();
    }
}

}  // namespace dashql
