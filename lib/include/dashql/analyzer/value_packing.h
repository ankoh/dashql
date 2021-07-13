// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_VALUE_PACKING_H_
#define INCLUDE_DASHQL_ANALYZER_VALUE_PACKING_H_

#include "arrow/scalar.h"
#include "dashql/proto_generated.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {

/// Pack a value
flatbuffers::Offset<proto::sql::SQLValue> PackValue(flatbuffers::FlatBufferBuilder& builder,
                                                    const arrow::Scalar& scalar);
/// Unpack a value
std::shared_ptr<arrow::Scalar> UnPackValue(const proto::sql::SQLValue& value);

}  // namespace dashql

#endif
