// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_DEFER_H_
#define INCLUDE_DASHQL_COMMON_DEFER_H_

#include <utility>

namespace dashql {

template <typename Fn, typename = std::is_nothrow_invocable<Fn>> class DeferredFunctionCall {
   private:
    /// The function that is deferred
    Fn func;

   public:
    /// Constructor
    explicit DeferredFunctionCall(Fn&& f) : func(std::forward<Fn>(f)) {}
    /// Destructor
    ~DeferredFunctionCall() { func(); }
};

template <typename Function, typename = std::is_nothrow_invocable<Function>>
inline DeferredFunctionCall<Function> defer(Function&& f) noexcept {
    return DeferredFunctionCall<Function>(std::forward<Function>(f));
}

}  // namespace dashql

#endif  // INCLUDE_DASHQL_COMMON_DEFER_H_
