// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_HASH_H_
#define INCLUDE_DASHQL_COMMON_HASH_H_

#include <array>

namespace dashql {

template <typename T, size_t N> struct ArrayHasher {
    size_t operator()(const std::array<T, N>& a) const {
        size_t h = 0;
        for (auto v : a) {
            h ^= std::hash<T>{}(v) + 0x9e3779b9 + (h << 6) + (h >> 2);
        }
        return h;
    }
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_COMMON_HASH_H_
