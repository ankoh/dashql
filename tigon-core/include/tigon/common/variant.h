//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_INFRA_VARIANT_H_
#define INCLUDE_TIGON_INFRA_VARIANT_H_

namespace tigon {

template<class... Ts> struct overload : Ts... { using Ts::operator()...; };
template<class... Ts> overload(Ts...) -> overload<Ts...>;

}

#endif // INCLUDE_TIGON_INFRA_VARIANT_H_
