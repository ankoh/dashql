#pragma once

namespace duckdb {
namespace web {

enum class Environment { WEB, NATIVE };

#if EMSCRIPTEN
constexpr auto ENVIRONMENT = Environment::WEB;
#else
constexpr auto ENVIRONMENT = Environment::NATIVE;
#endif

enum NativeTag { NATIVE };
enum WebTag { WEB };

}  // namespace web
}  // namespace duckdb
