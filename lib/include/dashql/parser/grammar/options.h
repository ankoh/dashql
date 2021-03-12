// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_GRAMMAR_OPTIONS_H_
#define INCLUDE_DASHQL_PARSER_GRAMMAR_OPTIONS_H_

#include <charconv>

#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"

namespace dashql {
namespace parser {

/// Get option as text
std::string_view optionToString(proto::syntax::AttributeKey key);
/// Read option from text
proto::syntax::AttributeKey optionFromString(std::string_view str);
/// Convert an option to camelcase (primarily for JSON)
std::string_view optionToCamelCase(std::string_view txt, std::string& tmp);

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_GRAMMAR_OPTIONS_H_
