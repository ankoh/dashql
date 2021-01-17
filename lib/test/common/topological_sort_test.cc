// Copyright (c) 2020 The DashQL Authors

#include "dashql/common/topological_sort.h"

#include <sstream>

#include "gtest/gtest.h"

using namespace std;
using namespace dashql;

namespace {

enum class TestOpType { POP, DEC };

struct TestOp {
    TestOpType type;
    int value;
};

std::pair<int, int> PUSH(int key, int rank) { return {key, rank}; }
TestOp POP(int value) { return {TestOpType::POP, value}; }
TestOp DEC(int value) { return {TestOpType::DEC, value}; }

struct TopoSortTest {
    std::vector<std::pair<int, int>> input;
    std::vector<TestOp> ops;
};

struct TopologicalSortTestSuite : ::testing::TestWithParam<TopoSortTest> {};

TEST_P(TopologicalSortTestSuite, SequenceMatches) {
    auto& param = GetParam();
    TopologicalSort<int> heap{param.input};
    for (auto [type, value] : param.ops) {
        if (type == TestOpType::DEC) {
            heap.DecrementKey(value);
        } else {
            ASSERT_FALSE(heap.Empty());
            ASSERT_EQ(std::get<0>(heap.Top()), value);
            heap.Pop();
        }
    }
    ASSERT_TRUE(heap.Empty());
}

INSTANTIATE_TEST_SUITE_P(ToplogicalSort, TopologicalSortTestSuite,
                         ::testing::Values(TopoSortTest{}, TopoSortTest{{PUSH(0, 0)}, {POP(0)}},
                                           TopoSortTest{{PUSH(0, 2), PUSH(1, 1)}, {POP(1), POP(0)}},
                                           TopoSortTest{{PUSH(0, 0), PUSH(1, 2), PUSH(2, 1), PUSH(3, 1)},
                                                        {POP(0), DEC(1), DEC(2), POP(2), POP(1), POP(3)}}));

}  // namespace
