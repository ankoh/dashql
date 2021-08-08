// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_TEST_ANALYZER_TESTS_H_
#define INCLUDE_DASHQL_PARSER_TEST_ANALYZER_TESTS_H_

#include <filesystem>
#include <string>

#include "dashql/analyzer/input_value.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/proto_generated.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

namespace dashql {
namespace test {

struct AnalyzerTest {
    /// Printer test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const AnalyzerTest*>& info) const {
            return std::string{info.param->name};
        }
    };

    struct TestStep {
        /// The previous program text
        std::string program_text = "";
        /// The input
        std::vector<InputValue> input_values = {};
        /// The expected plan
        pugi::xml_document expected_output = {};
        /// The task status of setup tasks
        std::vector<proto::task::TaskStatusCode> setupTaskStatusCodes = {};
        /// The task status of program tasks
        std::vector<proto::task::TaskStatusCode> programTaskStatusCodes = {};
    };

    /// The name
    std::string name = "";
    /// The steps
    std::vector<TestStep> steps = {};

    /// Get an task status code
    static proto::task::TaskStatusCode GetTaskStatus(std::string_view type);
    /// Read a parameter type
    static proto::syntax::InputComponentType GetInputType(std::string_view type);
    /// Get a parameter
    static arrow::Result<InputValue> GetInputValue(const pugi::xml_node& node);

    /// Encode the task graph
    static void EncodePlan(pugi::xml_node root, const ProgramInstance& program, const proto::task::TaskGraphT& graph);
    /// Get the grammar tests
    static arrow::Status LoadTests(std::filesystem::path& project_root);
    /// Get the grammar tests
    static std::vector<const AnalyzerTest*> GetTests(std::string_view filename);
};

}  // namespace test
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_TEST_ANALYZER_TESTS_H_
