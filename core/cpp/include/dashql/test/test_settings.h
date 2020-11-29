// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_TEST_GLOBALS_H_
#define INCLUDE_DASHQL_PARSER_TEST_GLOBALS_H_

#include <filesystem>
#include <string>

#include "dashql/program_instance.h"
#include "dashql/proto/action_generated.h"
#include "dashql/proto/syntax_generated.h"
#include "pugixml.hpp"

namespace dashql {
namespace test {

struct TestSettings {
    /// The path to the project root
    std::filesystem::path project_root = {};
    

    /// Get the test settings
    static TestSettings& Get();
};

}  // namespace test
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_TEST_GLOBALS_H_
