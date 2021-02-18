// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/function_logic.h"

#include <sstream>

#include "dashql/analyzer/syntax_matcher.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;
using namespace webdb;

namespace {

TEST(FormatTest, Empty) {
    auto arg = Value::VARCHAR(Ref, "foo");
    std::array<const Value*, 1> args{&arg};
    auto fmt = FunctionLogic::Resolve("format", args);
    auto res = fmt->Evaluate(args);
    ASSERT_TRUE(res.IsOk());
    ASSERT_EQ(std::string{res.value().GetUnsafeString()}, "foo");
}

TEST(FormatTest, IntegerParameter) {
    auto arg1 = Value::VARCHAR(Ref, "foo {}");
    auto arg2 = Value::BIGINT(static_cast<int64_t>(1));
    std::array<const Value*, 2> args{&arg1, &arg2};
    auto fmt = FunctionLogic::Resolve("format", args);
    auto res = fmt->Evaluate(args);
    ASSERT_TRUE(res.IsOk());
    ASSERT_EQ(std::string{res.value().GetUnsafeString()}, "foo 1");
}

TEST(FormatTest, StringParameter) {
    auto arg1 = Value::VARCHAR(Ref, "foo {} {}");
    auto arg2 = Value::BIGINT(static_cast<int64_t>(1));
    auto arg3 = Value::VARCHAR(Ref, "'bar'");
    std::array<const Value*, 3> args{
        &arg1,
        &arg2,
        &arg3
    };
    auto fmt = FunctionLogic::Resolve("format", args);
    auto res = fmt->Evaluate(args);
    ASSERT_TRUE(res.IsOk());
    ASSERT_EQ(std::string{res.value().GetUnsafeString()}, "foo 1 'bar'");
}

}  // namespace
