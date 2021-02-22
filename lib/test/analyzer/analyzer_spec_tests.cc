// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/analyzer.h"
#include "dashql/test/analyzer_tests.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

using namespace dashql;
using namespace dashql::test;

struct AnalyzerSpecTests : public testing::TestWithParam<const AnalyzerTest*> {};

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
            analyzer.UpdateSetupActionStatus(i, step.setupActionStatusCodes[i]);
        for (unsigned i = 0; i < step.programActionStatusCodes.size(); ++i) 
            analyzer.UpdateProgramActionStatus(i, step.programActionStatusCodes[i]);
    }
}

INSTANTIATE_TEST_SUITE_P(Clean, AnalyzerSpecTests, testing::ValuesIn(AnalyzerTest::GetTests("clean.xml")),
                         AnalyzerTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(ParameterUpdate, AnalyzerSpecTests, testing::ValuesIn(AnalyzerTest::GetTests("parameter_update.xml")),
                         AnalyzerTest::TestPrinter());
