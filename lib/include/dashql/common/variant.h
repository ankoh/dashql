// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_VARIANT_H_
#define INCLUDE_DASHQL_COMMON_VARIANT_H_

namespace dashql {

template <class... Ts> struct overload : Ts... { using Ts::operator()...; };
template <class... Ts> overload(Ts...) -> overload<Ts...>;

}  // namespace dashql

#endif  // INCLUDE_DASHQL_COMMON_VARIANT_H_
