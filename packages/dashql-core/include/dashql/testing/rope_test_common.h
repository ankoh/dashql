#ifndef DASHQL_CORE_TEST_ROPE_TEST_COMMON_H_
#define DASHQL_CORE_TEST_ROPE_TEST_COMMON_H_

#include "dashql/text/rope.h"

namespace dashql {
namespace rope_test {

static inline std::span<const std::byte> asBytes(std::string_view str) {
    return {reinterpret_cast<const std::byte*>(str.data()), str.size()};
}

struct TestableRope : public rope::Rope {
    explicit TestableRope(rope::Rope&& rope) : rope::Rope(std::move(rope)) {}
    explicit TestableRope(size_t page_size, rope::NodePtr root_node, rope::TextStats root_info,
                          rope::LeafNode* first_leaf, size_t tree_height)
        : rope::Rope(page_size, root_node, root_info, first_leaf, tree_height) {}
    explicit TestableRope(size_t page_size) : rope::Rope(page_size) {}

    static TestableRope FromString(size_t page_size, std::string_view text,
                                   size_t leaf_capacity = std::numeric_limits<size_t>::max(),
                                   size_t inner_capacity = std::numeric_limits<size_t>::max()) {
        return TestableRope{rope::Rope(page_size, text, leaf_capacity, inner_capacity)};
    }

    using rope::Rope::Append;
    using rope::Rope::InsertBounded;
    using rope::Rope::SplitOff;
};

}  // namespace rope_test
}  // namespace dashql

#endif  // DASHQL_CORE_TEST_ROPE_TEST_COMMON_H_
