// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_JSON_ENCODER_H_
#define INCLUDE_DASHQL_PARSER_JSON_ENCODER_H_

#include <string>

#include "dashql/parser/proto/syntax_generated.h"
#include "rapidjson/stringbuffer.h"

namespace dashql {
namespace parser {

/// Encode json string
rapidjson::StringBuffer encodeJSON(const proto::syntax::Module& module, bool pretty = false);

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
