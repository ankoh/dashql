// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/function_logic.h"

#include "arrow/visitor_inline.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;

namespace {

TEST(FormatTest, Empty) {
    auto arg = arrow::MakeScalar(arrow::utf8(), "foo").ValueOrDie();
    std::array<std::shared_ptr<arrow::Scalar>, 1> args{arg};
    auto fmt = FunctionLogic::Resolve("format", args);
    auto res = fmt->Evaluate(args);
    ASSERT_TRUE(res.ok());
    ASSERT_EQ(std::string{res.ValueUnsafe()->ToString()}, "foo");
}

TEST(FormatTest, IntegerParameter) {
    auto arg1 = arrow::MakeScalar(arrow::utf8(), "foo {}").ValueOrDie();
    auto arg2 = arrow::MakeScalar(arrow::int64(), 1).ValueOrDie();
    std::array<std::shared_ptr<arrow::Scalar>, 2> args{arg1, arg2};
    auto fmt = FunctionLogic::Resolve("format", args);
    auto res = fmt->Evaluate(args);
    ASSERT_TRUE(res.ok());
    ASSERT_EQ(std::string{res.ValueUnsafe()->ToString()}, "foo 1");
}

TEST(FormatTest, StringParameter) {
    auto arg1 = arrow::MakeScalar(arrow::utf8(), "foo {} {}").ValueOrDie();
    auto arg2 = arrow::MakeScalar(arrow::int64(), 1).ValueOrDie();
    auto arg3 = arrow::MakeScalar(arrow::utf8(), "'bar'").ValueOrDie();
    std::array<std::shared_ptr<arrow::Scalar>, 3> args{arg1, arg2, arg3};
    auto fmt = FunctionLogic::Resolve("format", args);
    auto res = fmt->Evaluate(args);
    ASSERT_TRUE(res.ok());
    ASSERT_EQ(std::string{res.ValueUnsafe()->ToString()}, "foo 1 'bar'");
}

}  // namespace
