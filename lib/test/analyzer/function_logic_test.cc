// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/function_logic.h"

#include <sstream>

#include "dashql/analyzer/syntax_matcher.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;

namespace {

TEST(FormatTest, Empty) {
    std::array<sxs::AConstType, 1> arg_types{
        sxs::AConstType::STRING
    };
    std::array<ConstantValue, 1> args{
        ConstantValue{std::string{"foo"}}
    };
    auto fmt = FunctionLogic::Resolve("format", arg_types);
    auto res = fmt->Evaluate(args);
    ASSERT_TRUE(res.IsOk());
    ASSERT_EQ(res.value().AsStringRef(), "foo");
}

TEST(FormatTest, IntegerParameter) {
    std::array<sxs::AConstType, 2> arg_types{
        sxs::AConstType::STRING,
        sxs::AConstType::INTEGER,
    };
    std::array<ConstantValue, 2> args{
        ConstantValue{std::string{"foo {}"}},
        ConstantValue{static_cast<int64_t>(1)},
    };
    auto fmt = FunctionLogic::Resolve("format", arg_types);
    auto res = fmt->Evaluate(args);
    ASSERT_TRUE(res.IsOk());
    ASSERT_EQ(res.value().AsStringRef(), "foo 1");
}

TEST(FormatTest, StringParameter) {
    std::array<sxs::AConstType, 3> arg_types{
        sxs::AConstType::STRING,
        sxs::AConstType::INTEGER,
        sxs::AConstType::STRING,
    };
    std::array<ConstantValue, 3> args{
        ConstantValue{std::string{"foo {} {}"}},
        ConstantValue{static_cast<int64_t>(1)},
        ConstantValue{std::string{"'bar'"}},
    };
    auto fmt = FunctionLogic::Resolve("format", arg_types);
    auto res = fmt->Evaluate(args);
    ASSERT_TRUE(res.IsOk());
    ASSERT_EQ(res.value().AsStringRef(), "foo 1 'bar'");
}

}  // namespace
