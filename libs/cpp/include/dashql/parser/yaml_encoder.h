// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_YAML_ENCODER_H_
#define INCLUDE_DASHQL_PARSER_YAML_ENCODER_H_

#include <string>

#include "dashql/parser/proto/syntax_generated.h"

namespace dashql {
namespace parser {

/// Encode yaml string
std::string encodeYAML(const proto::syntax::Module& module, bool pretty = false);

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
