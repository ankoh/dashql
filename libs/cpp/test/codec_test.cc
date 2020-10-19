// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/codec.h"

#include "dashql/parser/parse_context.h"
#include "dashql/parser/proto/program_generated.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"

using namespace dashql;
using namespace dashql::parser;
using namespace std;

namespace {

TEST(CodecTest, ParameterDeclaration) {
    auto in = R"RAW(
    declare parameter days type integer;
)RAW";
    ParseContext ctx;
    auto ast = ctx.Parse(in);
    ASSERT_EQ(ast.statements.size(), 1);
    ASSERT_EQ(ast.errors.size(), 0);

    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(WriteProgram(builder, ast));

    auto p = flatbuffers::GetRoot<proto::program::Program>(builder.GetBufferPointer());
    ASSERT_EQ(p->errors(), nullptr);
    ASSERT_NE(p->statements(), nullptr);
    ASSERT_EQ(p->statements()->size(), 1);
    auto entry = p->statements()->Get(0);
    ASSERT_EQ(entry->index(), 0);
    ASSERT_EQ(entry->tag(), proto::program::SectionTag::ParameterDeclaration);
    ASSERT_NE(p->sections(), nullptr);
    auto params = p->sections()->parameter_declarations();
    ASSERT_NE(params, nullptr);
    ASSERT_EQ(params->size(), 1);
    auto param = params->Get(0);
    ASSERT_NE(param, nullptr);
    ASSERT_EQ(param->tag(), proto::program::ParameterTag::INTEGER);
    ASSERT_EQ(param->name().tag(), proto::program::SectionTag::StringLiteral);
    ASSERT_EQ(param->name().index(), 0);
    auto strings = p->sections()->literals_string();
    ASSERT_NE(strings, nullptr);
    ASSERT_EQ(strings->size(), 2);
    ASSERT_EQ(strings->Get(0)->str(), "days");
}

}  // namespace
