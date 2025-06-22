#pragma once

#include <span>

#include "dashql/buffers/index_generated.h"
#include "frozen/unordered_map.h"

namespace dashql {

template <buffers::parser::AttributeKey> using AttributeLookupNodePtr = const buffers::parser::Node*;
template <buffers::parser::AttributeKey... Keys>
using AttributeLookupResult = std::tuple<AttributeLookupNodePtr<Keys>...>;

template <std::size_t N, auto First, auto... Rest> struct NthValueHelper {
    static constexpr auto value = NthValueHelper<N - 1, Rest...>::value;
};
template <auto First, auto... Rest> struct NthValueHelper<0, First, Rest...> {
    static constexpr auto value = First;
};
template <std::size_t N, auto... Vs> constexpr auto NthValue = NthValueHelper<N, Vs...>::value;

template <buffers::parser::AttributeKey... keys>
constexpr AttributeLookupResult<keys...> LookupAttributes(std::span<const buffers::parser::Node> children)
    requires(sizeof...(keys) == 1)
{
    for (auto& child : children) {
        if (child.attribute_key() == NthValue<0, keys...>) {
            return std::make_tuple(&child);
        }
    }
    return std::make_tuple(nullptr);
}

template <buffers::parser::AttributeKey... keys>
constexpr AttributeLookupResult<keys...> LookupAttributes(std::span<const buffers::parser::Node> children)
    requires(sizeof...(keys) >= 2)
{
    constexpr size_t N = sizeof...(keys);
    constexpr buffers::parser::AttributeKey MIN_KEY = std::min<buffers::parser::AttributeKey>({keys...});
    constexpr buffers::parser::AttributeKey MAX_KEY = std::max<buffers::parser::AttributeKey>({keys...});
    constexpr size_t ATTR_DIST = static_cast<size_t>(MAX_KEY) - static_cast<size_t>(MIN_KEY) + 1;

    // If the N is small, we'll just allocate a lookup table on the stack
    if constexpr (ATTR_DIST < 16) {
        std::array<const buffers::parser::Node*, ATTR_DIST> lookup{};
        lookup.fill(nullptr);
        for (auto& child : children) {
            if (child.attribute_key() < MIN_KEY || child.attribute_key() > MAX_KEY) continue;
            lookup[static_cast<size_t>(child.attribute_key()) - static_cast<size_t>(MIN_KEY)] = &child;
        }
        return [&]<std::size_t... I>(std::index_sequence<I...>) {
            return std::make_tuple(lookup[static_cast<size_t>(NthValue<I, keys...>) - static_cast<size_t>(MIN_KEY)]...);
        }(std::make_index_sequence<N>{});
    } else {
        // Otherwise, we'll construct a compile-time hash-table
        frozen::unordered_map<buffers::parser::AttributeKey, const buffers::parser::Node*, N> lookup{
            {keys, nullptr}...};
        for (auto& child : children) {
            auto iter = lookup.find(child.attribute_key());
            if (iter != lookup.end()) {
                iter->second = &child;
            }
        }
        return [&]<std::size_t... I>(std::index_sequence<I...>) {
            return std::make_tuple(lookup.at(NthValue<I, keys...>)...);
        }(std::make_index_sequence<N>{});
    }
}

}  // namespace dashql
