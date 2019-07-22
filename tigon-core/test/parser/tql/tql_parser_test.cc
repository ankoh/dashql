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
    auto program = ctx.Parse(in);
}

} // namespace
