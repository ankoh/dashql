//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include <gtest/gtest.h>
#include <sstream>
#include "tigon/parser/tql/tql_parse_context.h"

using namespace tigon::tql;

namespace {

    TEST(TQLTest, ParameterDeclaration) {
        auto in = R"RAW(
        declare parameter days as integer;
    )RAW";
        ParseContext ctx;
        auto module = ctx.Parse(in);
        ASSERT_EQ(module.statements.size(), 1);
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
    }

    TEST(TQLTest, ExtractJsonPath) {
        auto in = R"RAW(
        extract weather_data from raw_data using json ();
    )RAW";
        ParseContext ctx;
        auto module = ctx.Parse(in);
        ASSERT_EQ(module.statements.size(), 1);
    }

    TEST(TQLTest, VizLineChart) {
        auto in = R"RAW(
        visualize whether_data_line from wheather_data using line chart (
            area = (
                sm = 1,
                md = 3,
                lg = 6,
                xl = 6
            ),
            axes = (
                x = (column = "a", scale = linear),
                y = (column = "b", scale = linear)
            ),
            color = (
                column = "c",
                palette = [
                    rgb(0, 0, 0),
                    rgb(0, 0, 0)
                ]
            )
        );
    )RAW";
        ParseContext ctx;
        auto module = ctx.Parse(in);
        ASSERT_EQ(module.statements.size(), 1);
    }

    TEST(TQLTest, Query1) {
        auto in = R"RAW(
        select 1;
    )RAW";
        ParseContext ctx;
        auto module = ctx.Parse(in);
        ASSERT_EQ(module.statements.size(), 1);
    }

    TEST(TQLTest, Query2) {
        auto in = R"RAW(
        query "foo" as select 1;
    )RAW";
        ParseContext ctx;
        auto module = ctx.Parse(in);
        ASSERT_EQ(module.statements.size(), 1);
    }

} // namespace
