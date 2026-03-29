// Stub implementations for DuckDB compression functions
// These are needed when compression source files are excluded from the build

#include "duckdb/function/compression_function.hpp"
#include "duckdb/main/config.hpp"

namespace duckdb {

// Stub compression function with all required parameters set to nullptr
static CompressionFunction MakeStubCompressionFunction(CompressionType compression_type, PhysicalType data_type) {
    return CompressionFunction(
        compression_type, data_type,
        nullptr, // init_analyze
        nullptr, // analyze
        nullptr, // final_analyze
        nullptr, // init_compression
        nullptr, // compress
        nullptr, // compress_finalize
        nullptr, // init_scan
        nullptr, // scan_vector
        nullptr, // scan_partial
        nullptr, // fetch_row
        nullptr  // skip
    );
}

// Constant compression
struct ConstantFun {
    static CompressionFunction GetFunction(PhysicalType type) {
        return MakeStubCompressionFunction(CompressionType::COMPRESSION_CONSTANT, type);
    }
    static bool TypeIsSupported(PhysicalType type) { return false; }
    static void FiltersNullValues(const LogicalType&, const TableFilter&, bool&, bool&, TableFilterState&);
};

void ConstantFun::FiltersNullValues(const LogicalType&, const TableFilter&, bool&, bool&, TableFilterState&) {
    // No-op stub
}

// Uncompressed
struct UncompressedFun {
    static CompressionFunction GetFunction(PhysicalType type) {
        return MakeStubCompressionFunction(CompressionType::COMPRESSION_UNCOMPRESSED, type);
    }
    static bool TypeIsSupported(PhysicalType type) { return true; }
};

// DBConfig compression function lookups
optional_ptr<const CompressionFunction> DBConfig::TryGetCompressionFunction(CompressionType type, PhysicalType ptype) const {
    return nullptr;
}

reference<const CompressionFunction> DBConfig::GetCompressionFunction(CompressionType type, PhysicalType ptype) const {
    static CompressionFunction fallback = UncompressedFun::GetFunction(ptype);
    return fallback;
}

vector<reference<const CompressionFunction>> DBConfig::GetCompressionFunctions(PhysicalType ptype) const {
    vector<reference<const CompressionFunction>> result;
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
