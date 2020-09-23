//---------------------------------------------------------------------------
// DashQL
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_INFRA_VARIANT_H_
#define INCLUDE_TIGON_INFRA_VARIANT_H_

namespace dashql {

    template<class... Ts> struct overload : Ts... { using Ts::operator()...; };
    template<class... Ts> overload(Ts...)->overload<Ts...>;

} // namespace dashql

#endif // INCLUDE_TIGON_INFRA_VARIANT_H_
