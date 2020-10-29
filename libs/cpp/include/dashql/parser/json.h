// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_JSON_H_
#define INCLUDE_DASHQL_PARSER_JSON_H_

#include <string>

#include "dashql/parser/proto/syntax_generated.h"

namespace dashql {
namespace parser {

/// Encode json string
std::string encodeJSON(proto::syntax::Module& module);

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
