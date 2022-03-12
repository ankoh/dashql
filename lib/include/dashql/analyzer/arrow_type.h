// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_SQL_TYPE_H_
#define INCLUDE_DASHQL_ANALYZER_SQL_TYPE_H_

#include "arrow/result.h"
#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "dashql/proto_generated.h"

namespace dashql {

class ProgramInstance;

/// Do the buffers equal?
bool TypesEqual(const std::shared_ptr<arrow::DataType>& l, const std::shared_ptr<arrow::DataType>& r);
/// Read a type
arrow::Result<std::shared_ptr<arrow::DataType>> ReadTypeFrom(ProgramInstance& instance, size_t node_id);
/// Pack a type
flatbuffers::Offset<proto::sql::SQLType> PackType(flatbuffers::FlatBufferBuilder& builder, const arrow::DataType& r);
/// Unpack a type
std::shared_ptr<arrow::DataType> UnpackType(proto::sql::SQLTypeT& type);

}  // namespace dashql

#endif
