// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/parser_driver.h"
#include "dashql/test/grammar_tests.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

using namespace dashql;
using namespace dashql::test;

struct GrammarSpecTests : public testing::TestWithParam<const GrammarTest*> {};

TEST_P(GrammarSpecTests, Test) {
    auto* test = GetParam();
    auto program = parser::ParserDriver::Parse(test->input);

    pugi::xml_document out;
    GrammarTest::EncodeProgram(out, *program, test->input);

    ASSERT_TRUE(test->Matches(out));
}

INSTANTIATE_TEST_SUITE_P(Statement, GrammarSpecTests, testing::ValuesIn(GrammarTest::GetTests("dashql_statement.xml")),
                         GrammarTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Viz, GrammarSpecTests, testing::ValuesIn(GrammarTest::GetTests("dashql_viz.xml")),
                         GrammarTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Demo, GrammarSpecTests, testing::ValuesIn(GrammarTest::GetTests("scripts_demo.xml")),
                         GrammarTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(SQLSelect, GrammarSpecTests, testing::ValuesIn(GrammarTest::GetTests("sql_select.xml")),
                         GrammarTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(SQLCreate, GrammarSpecTests, testing::ValuesIn(GrammarTest::GetTests("sql_create.xml")),
                         GrammarTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(SQLView, GrammarSpecTests, testing::ValuesIn(GrammarTest::GetTests("sql_view.xml")),
                         GrammarTest::TestPrinter());
