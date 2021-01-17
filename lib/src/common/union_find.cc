// Copyright (c) 2020 The DashQL Authors

#include "dashql/common/union_find.h"

namespace dashql {

/// Constructor
UnionFind::UnionFind(size_t size) : entries_() {
    entries_.resize(size);
    for (unsigned i = 0; i < entries_.size(); ++i) {
        entries_[i] = {
            .parent = i,
            .rank = 0,
        };
    }
}

/// Return the root of the set that key belongs to
size_t UnionFind::Find(size_t key) {
    // Find the root of the set
    auto root = key;
    for (; root != entries_[root].parent; root = entries_[root].parent)
        ;
    // Path compression
    while (key != root) {
        auto parent = entries_[key].parent;
        entries_[key].parent = root;
        key = parent;
    }
    return root;
}

void UnionFind::Merge(size_t l, size_t r) {
    auto a = Find(l), b = Find(r);
    if (a == b) return;
    if (entries_[b].rank < entries_[a].rank) {
        entries_[b].parent = a;
    } else {
        entries_[a].parent = b;
        entries_[b].rank += (entries_[a].rank == entries_[b].rank);
    }
}

}  // namespace dashql
