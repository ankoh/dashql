// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_ARROW_SCALAR_H_
#define INCLUDE_DASHQL_ANALYZER_ARROW_SCALAR_H_

#include "arrow/result.h"
#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "dashql/proto_generated.h"

namespace dashql {

/// Pack a value
flatbuffers::Offset<proto::sql::SQLValue> PackScalar(flatbuffers::FlatBufferBuilder& builder,
                                                     const arrow::Scalar& scalar);
/// Unpack a value
arrow::Result<std::shared_ptr<arrow::Scalar>> UnpackScalar(const proto::sql::SQLValue& value);
/// Print a scalar value
std::string PrintScalar(const arrow::Scalar& scalar);
/// Print a scalar value
std::string PrintScalarForScript(const arrow::Scalar& scalar);

}  // namespace dashql

#endif
