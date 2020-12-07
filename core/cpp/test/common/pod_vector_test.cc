// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "dashql/common/pod_vector.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;

namespace {

TEST(PodVectorTest, SimpleOps) {
    PodVector<char> buffer;
    ASSERT_TRUE(buffer.empty());

    buffer.push_back(1);
    ASSERT_FALSE(buffer.empty());
    ASSERT_NE(buffer.begin(), nullptr);
    ASSERT_NE(buffer.end(), nullptr);
    ASSERT_EQ(*buffer.begin(), 1);

    buffer.pop_back();
    ASSERT_TRUE(buffer.empty());
}

TEST(PodVectorTest, Resize) {
    PodVector<char> buffer;
    ASSERT_TRUE(buffer.empty());

    buffer.resize(42);
    ASSERT_EQ(buffer.size(), 42);

    buffer.push_back(43);
    ASSERT_EQ(buffer.back(), 43);

    buffer.resize(84);
    buffer.resize(82);
    buffer.resize(64);
    ASSERT_EQ(buffer[42], 43);

    buffer.resize(0);
    ASSERT_TRUE(buffer.empty());
}

}
