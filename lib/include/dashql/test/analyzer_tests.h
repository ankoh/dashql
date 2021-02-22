// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_TEST_ANALYZER_TESTS_H_
#define INCLUDE_DASHQL_PARSER_TEST_ANALYZER_TESTS_H_

#include <filesystem>
#include <string>

#include "dashql/analyzer/parameter_value.h"
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
        /// The parameters
        std::vector<ParameterValue> parameters = {};
        /// The expected plan
        pugi::xml_document expected_plan = {};
        /// The action status of setup actions
        std::vector<proto::action::ActionStatusCode> setupActionStatusCodes = {};
        /// The action status of program actions
        std::vector<proto::action::ActionStatusCode> programActionStatusCodes = {};
    };

    /// The name
    std::string name = "";
    /// The steps
    std::vector<TestStep> steps = {};

    /// Get an action status code
    static proto::action::ActionStatusCode GetActionStatus(std::string_view type);
    /// Read a parameter type
    static proto::syntax::ParameterType GetParameterType(std::string_view type);
    /// Get a parameter
    static ParameterValue GetParameter(const pugi::xml_node& node);

    /// Encode the action graph
    static void EncodePlan(pugi::xml_node root, const ProgramInstance& program,
                           const proto::action::ActionGraphT& graph);
    /// Get the grammar tests
    static void LoadTests(std::filesystem::path& project_root);
    /// Get the grammar tests
    static std::vector<const AnalyzerTest*> GetTests(std::string_view filename);
};

}  // namespace test
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_TEST_ANALYZER_TESTS_H_
