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
    std::stringstream in{R"RAW(
        declare parameter days as integer;
    )RAW"};
    ParseContext ctx;
    ctx.Parse(in);
}

TEST(TQLTest, LoadHTTP) {
    std::stringstream in{R"RAW(
        load raw_data from http (
            url = 'http://www.google.com',
            method = get
        );
    )RAW"};
    ParseContext ctx;
    ctx.Parse(in);
}

TEST(TQLTest, ExtractJsonPath) {
    std::stringstream in{R"RAW(
        extract weather_data from raw_data using json ();
    )RAW"};
    ParseContext ctx;
    ctx.Parse(in);
}

TEST(TQLTest, DisplayLineChart) {
    std::stringstream in{R"RAW(
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
    )RAW"};
    ParseContext ctx;
    ctx.Parse(in);
}

} // namespace
