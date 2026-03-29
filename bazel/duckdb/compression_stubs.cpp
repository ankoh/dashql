// DBConfig compression function lookups
// Basic uncompressed compression is included from DuckDB source, but we need
// to provide the lookup/registration functions

#include "duckdb/function/compression_function.hpp"
#include "duckdb/main/config.hpp"

namespace duckdb {

// Forward declarations from actual DuckDB compression implementations
struct UncompressedFun {
    static CompressionFunction GetFunction(PhysicalType type);
};
struct ConstantFun {
    static CompressionFunction GetFunction(PhysicalType type);
    static bool TypeIsSupported(PhysicalType type);
};

// DBConfig compression function lookups
optional_ptr<const CompressionFunction> DBConfig::TryGetCompressionFunction(CompressionType type, PhysicalType ptype) const {
    // Uncompressed and constant compression are available
    if (type == CompressionType::COMPRESSION_UNCOMPRESSED) {
        static auto func = UncompressedFun::GetFunction(ptype);
        return &func;
    }
    if (type == CompressionType::COMPRESSION_CONSTANT && ConstantFun::TypeIsSupported(ptype)) {
        static auto func = ConstantFun::GetFunction(ptype);
        return &func;
    }
    return nullptr;
}

reference<const CompressionFunction> DBConfig::GetCompressionFunction(CompressionType type, PhysicalType ptype) const {
    // Try constant first if supported
    if (type == CompressionType::COMPRESSION_CONSTANT && ConstantFun::TypeIsSupported(ptype)) {
        static auto func = ConstantFun::GetFunction(ptype);
        return func;
    }
    // Default to uncompressed
    static auto func = UncompressedFun::GetFunction(ptype);
    return func;
}

vector<reference<const CompressionFunction>> DBConfig::GetCompressionFunctions(PhysicalType ptype) const {
    vector<reference<const CompressionFunction>> result;
    // Offer uncompressed and constant (if supported)
    static auto uncompressed = UncompressedFun::GetFunction(ptype);
    result.push_back(uncompressed);
    if (ConstantFun::TypeIsSupported(ptype)) {
        static auto constant = ConstantFun::GetFunction(ptype);
        result.push_back(constant);
    }
    return result;
}

vector<CompressionType> DBConfig::GetDisabledCompressionMethods() const {
    return vector<CompressionType>();
}

void DBConfig::SetDisabledCompressionMethods(const vector<CompressionType> &methods) {
    // No-op
}

// CompressionFunctionSet
CompressionFunctionSet::CompressionFunctionSet() {}

}  // namespace duckdb
