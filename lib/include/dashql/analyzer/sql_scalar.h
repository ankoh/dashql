// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_SQL_SCALAR_H_
#define INCLUDE_DASHQL_ANALYZER_SQL_SCALAR_H_

#include "arrow/scalar.h"
#include "dashql/proto_generated.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {

/// Pack a value
arrow::Result<flatbuffers::Offset<proto::sql::SQLValue>> PackArrowScalar(flatbuffers::FlatBufferBuilder& builder,
                                                                         const arrow::Scalar& scalar);
/// Unpack a value
arrow::Result<std::shared_ptr<arrow::Scalar>> UnpackArrowScalar(const proto::sql::SQLValue& value);

/// Print a scalar value
std::string PrintArrowScalar(const arrow::Scalar& scalar);

}  // namespace dashql

#endif
