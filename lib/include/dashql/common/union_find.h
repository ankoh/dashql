// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_UNION_FIND_H_
#define INCLUDE_DASHQL_COMMON_UNION_FIND_H_

#include "dashql/common/span.h"
#include <cassert>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace dashql {

class UnionFind {
   protected:
    /// An entry representing a set
    struct Entry {
        /// The parent int the set the entry belongs to
        size_t parent;
        /// The rank of the set (if root)
        size_t rank;
    };
    /// The entries
    std::vector<Entry> entries_;

   public:
    /// Constructor
    UnionFind(size_t size);
    /// Return the root of the set that key belongs to
    size_t Find(size_t id);
    /// Merge two sets
    void Merge(size_t l, size_t r);
};

template <typename T> class SparseUnionFind {
   public:
    /// An entry in the set
    struct Entry {
        /// The parent
        size_t parent;
        /// The rank
        size_t rank;
        /// The value
        T value;
    };

   protected:
    /// The entries
    std::unordered_map<size_t, Entry> entries_;

    /// Find a value
    Entry* FindEntry(size_t id) {
        auto origin = entries_.find(id);
        if (origin == entries_.end()) return nullptr;
        std::vector<Entry*> path{&origin->second};

        // Find the root of the set
        auto root_id = id;
        auto* root_node = path.back();
        while (root_id != root_node->parent) {
            root_id = root_node->parent;
            path.push_back(&entries_.at(root_id));
            root_node = path.back();
        }

        // Path compression
        for (size_t i = 0; (i + 1) < path.size(); ++i) {
            path[i]->parent = root_id;
        }
        return path.back();
    }

   public:
    /// Constructor
    SparseUnionFind(size_t capacity) : entries_() { entries_.reserve(capacity); }

    /// Insert a value
    void Insert(size_t id, T value) {
        assert(!entries_.count(id));
        // clang-format off
        entries_.insert({id, {
            .parent = id,
            .rank = 0,
            .value = std::move(value),
        }});
        // clang-format on
    }

    /// Find a value
    T* Find(size_t id) {
        auto entry = FindEntry(id);
        return !!entry ? &entry->value : nullptr;
    }

    /// Merge two sets
    Entry* Merge(size_t i, size_t j) {
        assert(entries_.count(i));
        assert(entries_.count(j));
        auto *a = FindEntry(i), *b = FindEntry(j);
        if (a == b) return a;
        if (b->rank < a->rank) {
            b->parent = a->parent;
            b->value = {};
            return a;
        } else {
            a->parent = b->parent;
            a->parent = {};
            b->rank += a->rank == b->rank;
            return b;
        }
    }

    /// Merge two sets and set the value of the sets
    void Merge(size_t i, size_t j, T value) {
        auto root = Merge(i, j);
        root->value = value;
    }

    /// Merge multiple nodes and set the value of the result
    void Merge(size_t origin, nonstd::span<size_t> nodes, T value) {
        if (nodes.empty()) {
            FindEntry(origin)->value = std::move(value);
            return;
        }
        Entry* e;
        for (auto n: nodes) {
            e = Merge(origin, n);
        }
        e->value = std::move(value);
    }

    /// Helper to iterate all values
    template <typename Fn>
    void IterateValues(Fn fn) const {
        for (auto [k, v]: entries_) {
            if (k == v.parent) {
                fn(k, v.value);
            }
        }
    }
};

}  // namespace dashql

#endif
