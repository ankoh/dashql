// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_UNION_FIND_H_
#define INCLUDE_DASHQL_COMMON_UNION_FIND_H_

#include <cassert>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "nonstd/span.h"

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

        /// Constructor
        Entry(size_t parent, size_t rank, T value) : parent(parent), rank(rank), value(std::move(value)) {}
        /// Move constructor
        Entry(Entry&& other) = default;
        /// Move assignment
        Entry& operator=(Entry&& other) = default;
    };

   protected:
    /// The entries
    std::unordered_map<size_t, Entry> entries_;

    /// Find a value
    Entry* FindEntry(size_t id) {
        auto origin = entries_.find(id);
        if (origin == entries_.end()) return nullptr;
        std::vector<Entry*> path;
        path.push_back(&origin->second);

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
    /// Explicit move constructor
    SparseUnionFind(SparseUnionFind&& other) = default;
    /// Explicit move constructor
    SparseUnionFind& operator=(SparseUnionFind&& other) = default;

    /// Insert a value
    const T* Insert(size_t id, T value) {
        assert(!entries_.count(id));
        auto [iter, ok] = entries_.emplace(id, Entry(id, 0, std::move(value)));
        return &iter->second.value;
    }

    /// Find a value
    const T* Find(size_t id) {
        auto* entry = FindEntry(id);
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
            a->value = {};
            b->rank += a->rank == b->rank;
            return b;
        }
    }

    /// Merge two sets and set the value of the sets
    const T* Merge(size_t i, size_t j, T value) {
        auto* root = Merge(i, j);
        root->value = std::move(value);
        return &root->value;
    }

    /// Merge multiple nodes and set the value of the result
    const T* Merge(size_t origin, nonstd::span<size_t> nodes, T value) {
        if (nodes.empty()) {
            auto* entry = FindEntry(origin);
            entry->value = std::move(value);
            return &entry->value;
        }
        Entry* e;
        for (auto n : nodes) {
            e = Merge(origin, n);
        }
        e->value = std::move(value);
        return &e->value;
    }

    /// Helper to iterate all values
    template <typename Fn> void IterateValues(Fn fn) const {
        for (auto& [k, v] : entries_) {
            if (k == v.parent) {
                fn(k, v.value);
            }
        }
    }
};

}  // namespace dashql

#endif
