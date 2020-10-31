// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/parser_driver.h"
#include "dashql/parser/yaml_encoder.h"
#include "gtest/gtest.h"
#include "flatbuffers/flatbuffers.h"

using namespace dashql::parser;
using namespace std;

namespace {



TEST(ParserTest, SELECT_FCONST) {
    auto in = R"RAW(
    select 1e-04;
)RAW";
    flatbuffers::FlatBufferBuilder builder;
    auto mo = ParserDriver::Parse(builder, in);
    builder.Finish(mo);
    auto m = flatbuffers::GetRoot<sx::Module>(builder.GetBufferPointer());
    ASSERT_EQ(m->errors()->size(), 0) << m->errors()->Get(0)->message()->c_str();
    ASSERT_EQ(m->statements()->entries()->size(), 1);

    auto s = encodeYAML(*m);
    ASSERT_EQ(s, "");
}

// TEST(ParserTest, ParameterDeclaration) {
//     auto in = R"RAW(
//     declare parameter days type integer;
// )RAW";
//     ParseContext ctx;
//     ctx.Parse(in);
//     ASSERT_EQ(ctx.statements().size(), 1);
//     ASSERT_EQ(ctx.errors().size(), 0);
// }
// 
// TEST(ParserTest, LoadHTTP) {
//     auto in = R"RAW(
//     load raw_data from http (
//         url = 'http://www.google.com',
//         method = get
//     );
// )RAW";
//     ParseContext ctx;
//     ctx.Parse(in);
//     ASSERT_EQ(ctx.statements().size(), 1);
//     ASSERT_EQ(ctx.errors().size(), 0);
// }
// 
// TEST(ParserTest, ExtractJsonPath) {
//     auto in = R"RAW(
//     extract weather_data from raw_data using json ();
// )RAW";
//     ParseContext ctx;
//     ctx.Parse(in);
//     ASSERT_EQ(ctx.statements().size(), 1);
//     ASSERT_EQ(ctx.errors().size(), 0);
// }
// 
// TEST(ParserTest, Query1) {
//     auto in = R"RAW(
//     select 1;
// )RAW";
//     ParseContext ctx;
//     ctx.Parse(in);
//     ASSERT_EQ(ctx.statements().size(), 1);
//     ASSERT_EQ(ctx.errors().size(), 0);
// }
// 
// TEST(ParserTest, Query2) {
//     auto in = R"RAW(
//     query "foo" as select 1;
// )RAW";
//     ParseContext ctx;
//     ctx.Parse(in);
//     ASSERT_EQ(ctx.statements().size(), 1);
//     ASSERT_EQ(ctx.errors().size(), 0);
// }
// 
// TEST(ParserTest, SyntaxError) {
//     auto in = "?";
//     ParseContext ctx;
//     ctx.Parse(in);
//     ASSERT_EQ(ctx.statements().size(), 0);
//     ASSERT_EQ(ctx.errors().size(), 1);
// }
// 
// TEST(ParserTest, SyntaxErrorRecovery) {
//     auto in = "?select * from foo;";
//     ParseContext ctx;
//     ctx.Parse(in);
//     ASSERT_EQ(ctx.statements().size(), 1);
//     ASSERT_EQ(ctx.errors().size(), 1);
// }

}  // namespace
