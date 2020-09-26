//---------------------------------------------------------------------------
// DashQL
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include <gtest/gtest.h>
#include <sstream>
#include "dashql/parser/tql/tql_parse_context.h"

using namespace dashql::tql;

namespace {
    TEST(TQLTest, ParameterDeclaration) {
        auto in = R"RAW(
        declare parameter days type integer;
    )RAW";
        ParseContext ctx;
        auto module = ctx.Parse(in);
        ASSERT_EQ(module.statements.size(), 1);
        ASSERT_EQ(module.errors.size(), 0);
    }

    TEST(TQLTest, LoadHTTP) {
        auto in = R"RAW(
        load raw_data from http (
            url = 'http://www.google.com',
            method = get
        );
    )RAW";
        ParseContext ctx;
        auto module = ctx.Parse(in);
        ASSERT_EQ(module.statements.size(), 1);
        ASSERT_EQ(module.errors.size(), 0);
    }

    TEST(TQLTest, ExtractJsonPath) {
        auto in = R"RAW(
        extract weather_data from raw_data using json ();
    )RAW";
        ParseContext ctx;
        auto module = ctx.Parse(in);
        ASSERT_EQ(module.statements.size(), 1);
        ASSERT_EQ(module.errors.size(), 0);
    }

    TEST(TQLTest, Query1) {
        auto in = R"RAW(
        select 1;
    )RAW";
        ParseContext ctx;
        auto module = ctx.Parse(in);
        ASSERT_EQ(module.statements.size(), 1);
        ASSERT_EQ(module.errors.size(), 0);
    }

    TEST(TQLTest, Query2) {
        auto in = R"RAW(
        query "foo" as select 1;
    )RAW";
        ParseContext ctx;
        auto module = ctx.Parse(in);
        ASSERT_EQ(module.statements.size(), 1);
        ASSERT_EQ(module.errors.size(), 0);
    }

    TEST(TQLTest, SyntaxError) {
        auto in = "?";
        ParseContext ctx;
        auto module = ctx.Parse(in);
        ASSERT_EQ(module.statements.size(), 0);
        ASSERT_EQ(module.errors.size(), 1);
    }

    TEST(TQLTest, SyntaxErrorRecovery) {
        auto in = "?select * from foo;";
        ParseContext ctx;
        auto module = ctx.Parse(in);
        ASSERT_EQ(module.statements.size(), 1);
        ASSERT_EQ(module.errors.size(), 1);
    }
} // namespace
