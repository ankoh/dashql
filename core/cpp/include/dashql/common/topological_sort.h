// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_MIN_HEAP_H_
#define INCLUDE_DASHQL_MIN_HEAP_H_

#include <tuple>
#include <unordered_map>
#include <vector>

namespace dashql {

/// A min heap
template <typename T> struct TopologicalSort {
   protected:
    /// The entries
    std::vector<std::pair<T, int>> entries_;
    /// The position index
    std::unordered_map<T, int> index_;

   public:
    /// Constructor
    TopologicalSort(std::vector<std::pair<T, int>> es) : entries_(move(es)), index_() {
        sort(entries_.begin(), entries_.end(), [](auto& l, auto& r) { return l.second < r.second; });
        for (int i = 0; i < entries_.size(); ++i) index_.insert({entries_[i].first, i});
    }

    /// Swap indices
    void SwapAt(int i, int j) {
        index_[entries_[i].first] = j;
        index_[entries_[j].first] = i;
        swap(entries_[i], entries_[j]);
    }

    /// Sift an element up
    void SiftUp(int i) {
        for (int p = (i - 1) / 2; i && (entries_[p].second > entries_[i].second);) {
            SwapAt(i, p);
            i = p;
            p = (i - 1) / 2;
        }
    }

    /// Sift an element down
    void SiftDown(int i) {
        while (true) {
            auto l = 2 * i + 1;
            auto r = 2 * i + 2;
            auto prev = i;
            if (l < entries_.size() && entries_[l].second < entries_[i].second) {
                SwapAt(l, i);
                i = l;
            }
            if (r < entries_.size() && entries_[r].second < entries_[i].second) {
                SwapAt(r, i);
                i = r;
            }
            if (prev == i) {
                break;
            }
        }
    }

    /// Heap is empty?
    bool Empty() { return entries_.empty(); }
    /// Get the min element
    auto& Top() { return entries_.front(); }
    /// Pop the min element
    void Pop() {
        SwapAt(0, entries_.size() - 1);
        entries_.pop_back();
        SiftDown(0);
    }

    /// Decrement the key
    void DecrementKey(T k) {
        auto i = index_[k];
        if (entries_[i].second > 0) {
            --entries_[i].second;
            SiftUp(i);
        }
    }

    /// Get the key
    int GetKey(T k) {
        auto i = index_[k];
        return entries_[i].second;
    }
};

}  // namespace dashql

#endif
