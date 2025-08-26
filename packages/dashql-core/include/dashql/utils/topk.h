#pragma once

#include <algorithm>
#include <cassert>
#include <cstddef>
#include <vector>

namespace dashql {

/// The top-k heap is modeled as min heap.
/// We track the current min element and replace it if a new element is larger than the minimum.
/// After replacing, we bubble down the heap root to determine the new minimum.
template <typename ValueType> struct TopKHeap {
   protected:
    /// The max-heap entries
    std::vector<ValueType> entries;

   public:
    /// Constructor
    TopKHeap(size_t capacity = 10) { entries.reserve(capacity); }
    /// Helper to move the top-element down
    void FixHeap() {
        size_t i = 0;
        while (true) {
            size_t li = 2 * i + 1;
            size_t ri = 2 * i + 2;
            size_t best = i;
            if (li < entries.size() && entries[li] < entries[best]) {
                best = li;
            }
            if (ri < entries.size() && entries[ri] < entries[best]) {
                best = ri;
            }
            if (best == i) {
                break;
            }
            std::swap(entries[i], entries[best]);
            i = best;
        }
    }
    /// Insert an entry
    void Insert(ValueType value) {
        assert(entries.capacity() > 0);
        // Check if the heap has space
        if (entries.size() < entries.capacity()) {
            entries.push_back(std::move(value));
            if (entries.size() == entries.capacity()) {
                std::sort(entries.begin(), entries.end());
            }
        } else {
            auto& min = entries.front();
            if (min < value) {
                min = std::move(value);
                FixHeap();
            }
        }
    }
    /// Clear the heap
    void Clear() { entries.clear(); }
    /// Finish the entries
    std::vector<ValueType>& Finish() {
        /// Sort in descending order to get top-k from left to right.
        std::sort(entries.begin(), entries.end(), [](auto& l, auto& r) { return r < l; });
        return entries;
    }
    /// Get the heap entries
    auto& GetEntries() const { return entries; }
};

}  // namespace dashql
