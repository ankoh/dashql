// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_TEST_ACTION_TEST_ENCODER_H_
#define INCLUDE_DASHQL_PARSER_TEST_ACTION_TEST_ENCODER_H_

#include <filesystem>
#include <string>

#include "dashql/program_instance.h"
#include "dashql/proto/action_generated.h"
#include "dashql/proto/syntax_generated.h"
#include "ryml_std.hpp"
#include "ryml.hpp"

namespace dashql {
namespace parser {

void EncodeActionTes(ryml::NodeRef ref, const ProgramInstance& program, const proto::action::ActionGraphT* graph);

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_TEST_ACTION_TEST_ENCODER_H_
