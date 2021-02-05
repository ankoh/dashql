// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/parser_driver.h"
#include "dashql/test/grammar_tests.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

using namespace dashql;
using namespace dashql::test;

struct GrammarTestSuite : public testing::TestWithParam<const GrammarTest*> {};

TEST_P(GrammarTestSuite, Test) {
    auto* test = GetParam();
    auto program = parser::ParserDriver::Parse(test->input);

    pugi::xml_document out;
    GrammarTest::EncodeProgram(out, *program, test->input);

    ASSERT_TRUE(test->Matches(out));
}

INSTANTIATE_TEST_SUITE_P(Statement, GrammarTestSuite, testing::ValuesIn(GrammarTest::GetTests("dashql_statement.xml")),
                         GrammarTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Viz, GrammarTestSuite, testing::ValuesIn(GrammarTest::GetTests("dashql_viz.xml")),
                         GrammarTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Demo, GrammarTestSuite, testing::ValuesIn(GrammarTest::GetTests("scripts_demo.xml")),
                         GrammarTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(SQLSelect, GrammarTestSuite, testing::ValuesIn(GrammarTest::GetTests("sql_select.xml")),
                         GrammarTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(SQLCreate, GrammarTestSuite, testing::ValuesIn(GrammarTest::GetTests("sql_create.xml")),
                         GrammarTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(SQLView, GrammarTestSuite, testing::ValuesIn(GrammarTest::GetTests("sql_view.xml")),
                         GrammarTest::TestPrinter());
