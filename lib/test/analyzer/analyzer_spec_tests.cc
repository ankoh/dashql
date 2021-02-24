// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/analyzer.h"
#include "dashql/test/analyzer_tests.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

using namespace dashql;
using namespace dashql::test;

struct AnalyzerSpecTests : public testing::TestWithParam<const AnalyzerTest*> {};

/// Matches the expected result?
static ::testing::AssertionResult Matches(const pugi::xml_node& actual, const pugi::xml_node& expected) {
    std::stringstream expected_ss;
    std::stringstream actual_ss;
    expected.print(expected_ss);
    actual.print(actual_ss);
    auto expected_str = expected_ss.str();
    auto actual_str = actual_ss.str();
    if (expected_str == actual_str) return ::testing::AssertionSuccess();

    std::stringstream err;

    err << std::endl;
    err << "OUTPUT" << std::endl;
    err << "----------------------------------------" << std::endl;
    err << actual_str << std::endl;

    err << "EXPECTED" << std::endl;
    err << "----------------------------------------" << std::endl;
    std::vector<std::string> expected_lines, actual_lines;
    ::testing::internal::SplitString(expected_str, '\n', &expected_lines);
    ::testing::internal::SplitString(actual_str, '\n', &actual_lines);
    err << ::testing::internal::edit_distance::CreateUnifiedDiff(actual_lines, expected_lines);
    err << std::endl;

    return ::testing::AssertionFailure() << err.str();
}

TEST_P(AnalyzerSpecTests, Test) {
    auto* test = GetParam();

    Analyzer analyzer;
    for (auto& step: test->steps) {
        // Parse, instantiate and plan the program
        auto rc = analyzer.ParseProgram(step.program_text);
        ASSERT_TRUE(rc.IsOk());
        rc = analyzer.InstantiateProgram(step.parameters);
        ASSERT_TRUE(rc.IsOk());
        rc = analyzer.PlanProgram();
        ASSERT_TRUE(rc.IsOk());

        // Update the action status for the next step
        for (unsigned i = 0; i < step.setupActionStatusCodes.size(); ++i) 
            analyzer.UpdateActionStatus(proto::action::ActionClass::SETUP_ACTION, i, step.setupActionStatusCodes[i]);
        for (unsigned i = 0; i < step.programActionStatusCodes.size(); ++i) 
            analyzer.UpdateActionStatus(proto::action::ActionClass::PROGRAM_ACTION, i, step.programActionStatusCodes[i]);


        // Encode the test output
        pugi::xml_document out;
        auto* instance = analyzer.program_instance();
        auto* graph = analyzer.planned_graph();
        ASSERT_NE(instance, nullptr);
        ASSERT_NE(graph, nullptr);
        AnalyzerTest::EncodePlan(out, *instance, *graph);

        // Try to match the test output with the expected output
        ASSERT_TRUE(Matches(out, step.expected_output));
    }
}

INSTANTIATE_TEST_SUITE_P(Clean, AnalyzerSpecTests, testing::ValuesIn(AnalyzerTest::GetTests("clean.xml")),
                         AnalyzerTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(ParameterUpdate, AnalyzerSpecTests, testing::ValuesIn(AnalyzerTest::GetTests("parameter_update.xml")),
                         AnalyzerTest::TestPrinter());
