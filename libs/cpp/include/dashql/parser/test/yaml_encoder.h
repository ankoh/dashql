// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_TEST_YAML_ENCODER_H_
#define INCLUDE_DASHQL_PARSER_TEST_YAML_ENCODER_H_

#include <filesystem>
#include <string>

#include "dashql/parser/proto/syntax_generated.h"
#include "ryml.hpp"

namespace dashql {
namespace parser {


static void EncodeTestExpectation(ryml::NodeRef ref, const proto::syntax::Module& module, std::string_view text);


}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_TEST_YAML_ENCODER_H_
