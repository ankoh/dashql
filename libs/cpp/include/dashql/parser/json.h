// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_JSON_H_
#define INCLUDE_DASHQL_PARSER_JSON_H_

#include <string>

#include "rapidjson/stringbuffer.h"

#include "dashql/parser/proto/syntax_generated.h"

namespace dashql {
namespace parser {

/// Encode json string
rapidjson::StringBuffer encodeJSON(proto::syntax::Module& module, bool pretty = false);

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
