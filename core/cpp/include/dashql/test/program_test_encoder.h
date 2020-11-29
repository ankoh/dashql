// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_TEST_PROGRAM_TEST_ENCODER_H_
#define INCLUDE_DASHQL_PARSER_TEST_PROGRAM_TEST_ENCODER_H_

#include <filesystem>
#include <string>

#include "dashql/proto/syntax_generated.h"
#include "pugixml.hpp"

namespace dashql {
namespace test {

void EncodeProgramTest(pugi::xml_node& root, const proto::syntax::ProgramT& program, std::string_view text);

}  // namespace test
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_TEST_PROGRAM_TEST_ENCODER_H_
