#pragma once

#include <cstddef>
#include <functional>
#include <string>
#include <tuple>

#include "dashql/utils/murmur3.h"

namespace dashql {

template <class T> inline void hash_combine(std::size_t& seed, const T& v) {
    std::hash<T> hasher;
    seed ^= hasher(v) + 0x9e3779b9 + (seed << 6) + (seed >> 2);
}

struct TupleHasher {
    template <typename... Args> size_t operator()(const std::tuple<Args...>& key) const {
        size_t hash = 0;
        std::apply([&](auto&... arg) { (hash_combine(hash, arg), ...); }, key);
        return hash;
    }
    template <typename... Args> size_t operator()(const std::pair<Args...>& key) const {
        size_t hash = 0;
        std::apply([&](auto&... arg) { (hash_combine(hash, arg), ...); }, key);
        return hash;
    }
};

struct StringHasher {
    using is_transparent = void;

    std::size_t operator()(const char* str) const { return Hash(str); }
    std::size_t operator()(std::string_view str) const { return Hash(str); }
    std::size_t operator()(std::string const& str) const { return Hash(str); }

    static uint32_t Hash(std::string_view text, uint32_t seed = 0) {
        uint32_t out = 0;
        MurmurHash3_x86_32(text.data(), text.size(), seed, &out);
        return out;
    }
};

struct StringPairHasher {
    using is_transparent = void;
    using view_hasher = std::hash<std::string_view>;

    size_t operator()(std::pair<std::string_view, std::string_view> str) const {
        size_t hash = 0;
        hash_combine(hash, StringHasher::Hash(str.first));
        hash_combine(hash, StringHasher::Hash(str.second));
        return hash;
    }
    size_t operator()(std::pair<std::string, std::string> const& str) const {
        size_t hash = 0;
        hash_combine(hash, StringHasher::Hash(str.first));
        hash_combine(hash, StringHasher::Hash(str.second));
        return hash;
    }
};

struct StringPairEqual {
    using is_transparent = std::true_type;

    template <typename A, typename B> bool operator()(std::pair<A, A> l, std::pair<B, B> r) const noexcept {
        std::pair<std::string_view, std::string_view> l_view = l;
        std::pair<std::string_view, std::string_view> r_view = r;
        return l_view == r_view;
    }
};

}  // namespace dashql
