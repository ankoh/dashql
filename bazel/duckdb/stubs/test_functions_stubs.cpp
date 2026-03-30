// Stub implementations for DuckDB test functions
// These are SQLite compatibility functions that are not needed

#include "duckdb/function/built_in_functions.hpp"

namespace duckdb {

struct TestAllTypesFun {
    static void RegisterFunction(BuiltinFunctions &set);
};

struct TestVectorTypesFun {
    static void RegisterFunction(BuiltinFunctions &set);
};

void TestAllTypesFun::RegisterFunction(BuiltinFunctions &set) {
    // No-op stub - test function not needed
}

void TestVectorTypesFun::RegisterFunction(BuiltinFunctions &set) {
    // No-op stub - test function not needed
}

}  // namespace duckdb
