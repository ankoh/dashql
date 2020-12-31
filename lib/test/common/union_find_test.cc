// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "dashql/common/union_find.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;

namespace {

TEST(UnionFind, SimpleOps) {
    UnionFind uf{4};
    ASSERT_EQ(uf.Find(0), 0);
    ASSERT_EQ(uf.Find(1), 1);
    ASSERT_EQ(uf.Find(2), 2);
    ASSERT_EQ(uf.Find(3), 3);
    uf.Merge(0, 3);
    ASSERT_EQ(uf.Find(0), uf.Find(3));
    ASSERT_EQ(uf.Find(1), 1);
    ASSERT_EQ(uf.Find(2), 2);
    uf.Merge(0, 2);
    ASSERT_EQ(uf.Find(0), uf.Find(3));
    ASSERT_EQ(uf.Find(0), uf.Find(2));
    ASSERT_EQ(uf.Find(1), 1);
}

TEST(SparseUnionFind, SimpleOps) {
    SparseUnionFind<const char*> uf{64};
    ASSERT_EQ(uf.Find(0), nullptr);
    uf.Insert(42, "u");
    ASSERT_EQ(uf.Find(0), nullptr);
    ASSERT_TRUE(!!uf.Find(42));
    ASSERT_EQ(*uf.Find(42), "u");
    uf.Insert(1, "v");
    ASSERT_TRUE(!!uf.Find(42));
    ASSERT_TRUE(!!uf.Find(1));
    ASSERT_EQ(*uf.Find(42), "u");
    ASSERT_EQ(*uf.Find(1), "v");
    uf.Merge(1, 42, "w");
    ASSERT_TRUE(!!uf.Find(42));
    ASSERT_TRUE(!!uf.Find(1));
    ASSERT_EQ(*uf.Find(42), "w");
    ASSERT_EQ(*uf.Find(1), "w");
    uf.Insert(2, "a");
    uf.Insert(3, "b");
    uf.Insert(4, "c");
    uf.Merge(2, 42, "d");
    uf.Merge(3, 42, "e");
    uf.Merge(4, 42, "f");
    ASSERT_TRUE(!!uf.Find(1));
    ASSERT_TRUE(!!uf.Find(2));
    ASSERT_TRUE(!!uf.Find(3));
    ASSERT_TRUE(!!uf.Find(4));
    ASSERT_TRUE(!!uf.Find(42));
    ASSERT_EQ(*uf.Find(1), "f");
    ASSERT_EQ(*uf.Find(2), "f");
    ASSERT_EQ(*uf.Find(3), "f");
    ASSERT_EQ(*uf.Find(4), "f");
    ASSERT_EQ(*uf.Find(42), "f");
}

}
