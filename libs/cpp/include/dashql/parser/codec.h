// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_CODEC_H_
#define INCLUDE_DASHQL_PARSER_CODEC_H_

#include "dashql/parser/proto/program_generated.h"
#include "dashql/parser/syntax.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {
namespace parser {

flatbuffers::Offset<proto::program::Program> WriteProgram(flatbuffers::FlatBufferBuilder& builder,
                                                          Program& program);

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_CODEC_H_
