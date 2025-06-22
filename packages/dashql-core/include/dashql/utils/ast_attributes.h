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
    frozen::unordered_map<buffers::parser::AttributeKey, const buffers::parser::Node*, N> lookup{{keys, nullptr}...};
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

}  // namespace dashql
