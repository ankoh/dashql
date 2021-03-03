// Copyright (c) 2020 The DashQL Authors

#include "dashql/dataframe/dataframe.h"

#include "gtest/gtest.h"

using namespace dashql;
using namespace std;

namespace {

TEST(Dataframe, Constructor) {
    auto query = dataframe::Dataframe::AlgebraTree();
    auto dataframe = dataframe::Dataframe(query);
    ASSERT_TRUE(true);
}

}  // namespace
