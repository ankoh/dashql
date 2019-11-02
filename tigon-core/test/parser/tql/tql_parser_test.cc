//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/parser/tql/tql_parse_context.h"
#include <gtest/gtest.h>
#include <sstream>

using namespace tigon::tql;

namespace {

TEST(TQLTest, ParameterDeclaration) {
    auto in = R"RAW(
        declare parameter days as integer;
    )RAW";
    ParseContext ctx;
    auto program = ctx.Parse(in);
    ASSERT_EQ(program.statements.size(), 1);
}

TEST(TQLTest, LoadHTTP) {
    auto in = R"RAW(
        load raw_data from http (
            url = 'http://www.google.com',
            method = get
        );
    )RAW";
    ParseContext ctx;
    auto program = ctx.Parse(in);
    ASSERT_EQ(program.statements.size(), 1);
}

TEST(TQLTest, ExtractJsonPath) {
    auto in = R"RAW(
        extract weather_data from raw_data using json ();
    )RAW";
    ParseContext ctx;
    auto program = ctx.Parse(in);
    ASSERT_EQ(program.statements.size(), 1);
}

TEST(TQLTest, DisplayLineChart) {
    auto in = R"RAW(
        display wheather_data using line chart (
            layout = (
                width = (
                    * = 8,
                    sm = 4,
                    md = 6,
                    lg = 8,
                    xl = 8
                ),
                height = (
                    * = 100px,
                    sm = 200px
                )
            ),
            axes = (
                x = (
                    column = a,
                    scale = linear
                ),
                y = (
                    column = b,
                    scale = linear
                )
            ),
            color = (
                column = c,
                palette = [
                    rgb(0, 0, 0),
                    rgb(0, 0, 0)
                ]
            )
        );
    )RAW";
    ParseContext ctx;
    auto program = ctx.Parse(in);
    ASSERT_EQ(program.statements.size(), 1);
}

TEST(TQLTest, Query1) {
    auto in = R"RAW(
        select 1;
    )RAW";
    ParseContext ctx;
    auto program = ctx.Parse(in);
    ASSERT_EQ(program.statements.size(), 1);
}

} // namespace
