#include "dashql/utils/chunk_buffer.h"

#include "gtest/gtest.h"

using namespace dashql;

namespace {

TEST(ChunkBufferTest, Sequence) {
    ChunkBuffer<uint32_t> tree;
    for (size_t i = 0; i < 1024; ++i) {
        tree.PushBack(i);
        ASSERT_EQ(tree[i], i);
    }
    ASSERT_EQ(tree.GetSize(), 1024);
}

}  // namespace
