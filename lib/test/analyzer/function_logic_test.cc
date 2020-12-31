// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/function_logic.h"

#include <sstream>

#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/webdb/value.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;
using namespace webdb;

namespace {

TEST(FormatTest, Empty) {
    std::array<Value, 1> args{
        Value::VARCHAR(Ref, "foo")
    };
    auto fmt = FunctionLogic::Resolve("format", args);
    auto res = fmt->Evaluate(args);
    ASSERT_TRUE(res.IsOk());
    ASSERT_EQ(res.value().GetUnsafeString(), "foo");
}

TEST(FormatTest, IntegerParameter) {
    std::array<Value, 2> args{
        Value::VARCHAR(Ref, "foo {}"),
        Value::BIGINT(static_cast<int64_t>(1)),
    };
    auto fmt = FunctionLogic::Resolve("format", args);
    auto res = fmt->Evaluate(args);
    ASSERT_TRUE(res.IsOk());
    ASSERT_EQ(res.value().GetUnsafeString(), "foo 1");
}

TEST(FormatTest, StringParameter) {
    std::array<Value, 3> args{
        Value::VARCHAR(Ref, "foo {} {}"),
        Value::BIGINT(static_cast<int64_t>(1)),
        Value::VARCHAR(Ref, "'bar'"),
    };
    auto fmt = FunctionLogic::Resolve("format", args);
    auto res = fmt->Evaluate(args);
    ASSERT_TRUE(res.IsOk());
    ASSERT_EQ(res.value().GetUnsafeString(), "foo 1 'bar'");
}

}  // namespace
