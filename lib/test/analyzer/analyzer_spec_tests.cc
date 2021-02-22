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
        auto rc = analyzer.ParseProgram(step.program_text);
        ASSERT_TRUE(rc.IsOk());
        rc = analyzer.InstantiateProgram(std::move(step.parameters));
        ASSERT_TRUE(rc.IsOk());
        rc = analyzer.PlanProgram();
        ASSERT_TRUE(rc.IsOk());
        /// XXX action status
    }
}

INSTANTIATE_TEST_SUITE_P(Clean, AnalyzerSpecTests, testing::ValuesIn(AnalyzerTest::GetTests("clean.xml")),
                         AnalyzerTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(ParameterUpdate, AnalyzerSpecTests, testing::ValuesIn(AnalyzerTest::GetTests("parameter_update.xml")),
                         AnalyzerTest::TestPrinter());
