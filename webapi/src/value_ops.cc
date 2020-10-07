// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/value_ops.h"

#include "duckdb/common/operator/numeric_binary_operators.hpp"
#include "duckdb/common/types.hpp"
#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/time.hpp"
#include "duckdb/common/types/timestamp.hpp"
#include "duckdb_webapi/codec.h"
#include "duckdb_webapi/common/exception.h"

namespace duckdb_webapi {

template <class OP> static Value execBinary(const Value &left, const Value &right) {
    auto left_type = left.GetLogicalType();
    auto right_type = right.GetLogicalType();
    auto result_type = left_type;
    if (left_type != right_type) {
        result_type = LogicalType::MaxType(left.GetLogicalType(), right.GetLogicalType());
        Value left_cast = left.CastAs(result_type);
        Value right_cast = right.CastAs(result_type);
        return execBinary<OP>(left_cast, right_cast);
    }
    if (left.IsNull() || right.IsNull()) {
        return Value().CastAs(result_type);
    }
    if (LogicalType::IsIntegral(LogicalType::GetPhysicalType(result_type))) {
        // integer addition
        return Value::NUMERIC(result_type, OP::template Operation<hugeint_t, hugeint_t, hugeint_t>(
                                               left.GetValue<hugeint_t>(), right.GetValue<hugeint_t>()));
    } else if (LogicalType::GetPhysicalType(result_type) == proto::PhysicalTypeID::FLOAT) {
        return Value::FLOAT(
            OP::template Operation<float, float, float>(left.GetValue<float>(), right.GetValue<float>()));
    } else if (LogicalType::GetPhysicalType(result_type) == proto::PhysicalTypeID::DOUBLE) {
        return Value::DOUBLE(
            OP::template Operation<double, double, double>(left.GetValue<double>(), right.GetValue<double>()));
    } else {
        throw Exception{ET::NOT_IMPLEMENTED, "Unimplemented type for value binary op"};
    }
}

Value ValueOperations::Add(const Value &left, const Value &right) {
    return execBinary<duckdb::AddOperator>(left, right);
}

Value ValueOperations::Subtract(const Value &left, const Value &right) {
    return execBinary<duckdb::SubtractOperator>(left, right);
}

Value ValueOperations::Multiply(const Value &left, const Value &right) {
    return execBinary<duckdb::MultiplyOperator>(left, right);
}

Value ValueOperations::Modulo(const Value &left, const Value &right) {
    if (right == 0) {
        return execBinary<duckdb::ModuloOperator>(left, Value(right.GetLogicalType()));
    } else {
        return execBinary<duckdb::ModuloOperator>(left, right);
    }
}

Value ValueOperations::Divide(const Value &left, const Value &right) {
    if (right == 0) {
        return execBinary<duckdb::DivideOperator>(left, Value(right.GetLogicalType()));
    } else {
        return execBinary<duckdb::DivideOperator>(left, right);
    }
}

}  // namespace duckdb_webapi
