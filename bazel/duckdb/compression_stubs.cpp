// DBConfig compression function lookups
// Uses unique_ptr to avoid moving CompressionFunction objects (they contain function pointers)

#include "duckdb/function/compression_function.hpp"
#include "duckdb/main/config.hpp"
#include <vector>
#include <memory>

namespace duckdb {

// Forward declarations from actual DuckDB compression implementations
struct UncompressedFun {
    static CompressionFunction GetFunction(PhysicalType type);
};
struct ConstantFun {
    static CompressionFunction GetFunction(PhysicalType type);
    static bool TypeIsSupported(PhysicalType type);
};
struct RLEFun {
    static CompressionFunction GetFunction(PhysicalType type);
    static bool TypeIsSupported(PhysicalType type);
};
struct BitpackingFun {
    static CompressionFunction GetFunction(PhysicalType type);
    static bool TypeIsSupported(PhysicalType type);
};

// Cache entry - stores CompressionFunction in a unique_ptr to avoid moves
struct CacheEntry {
    PhysicalType ptype;
    std::unique_ptr<CompressionFunction> func;
};

// Simple cache using vector - avoids std::map for WASM compatibility
struct CompressionCache {
    std::vector<CacheEntry> entries;

    const CompressionFunction* find(PhysicalType ptype) {
        for (auto& entry : entries) {
            if (entry.ptype == ptype) {
                return entry.func.get();
            }
        }
        return nullptr;
    }

    const CompressionFunction& insert(PhysicalType ptype, CompressionFunction func) {
        entries.push_back({ptype, std::make_unique<CompressionFunction>(std::move(func))});
        return *entries.back().func;
    }
};

// Per-type caches - initialized on first use
static CompressionCache& get_uncompressed_cache() {
    static CompressionCache cache;
    return cache;
}

static CompressionCache& get_constant_cache() {
    static CompressionCache cache;
    return cache;
}

static CompressionCache& get_rle_cache() {
    static CompressionCache cache;
    return cache;
}

static CompressionCache& get_bitpacking_cache() {
    static CompressionCache cache;
    return cache;
}

static const CompressionFunction& GetOrCreateUncompressed(PhysicalType ptype) {
    auto& cache = get_uncompressed_cache();
    if (auto* func = cache.find(ptype)) {
        return *func;
    }
    return cache.insert(ptype, UncompressedFun::GetFunction(ptype));
}

static const CompressionFunction& GetOrCreateConstant(PhysicalType ptype) {
    auto& cache = get_constant_cache();
    if (auto* func = cache.find(ptype)) {
        return *func;
    }
    return cache.insert(ptype, ConstantFun::GetFunction(ptype));
}

static const CompressionFunction& GetOrCreateRLE(PhysicalType ptype) {
    auto& cache = get_rle_cache();
    if (auto* func = cache.find(ptype)) {
        return *func;
    }
    return cache.insert(ptype, RLEFun::GetFunction(ptype));
}

static const CompressionFunction& GetOrCreateBitpacking(PhysicalType ptype) {
    auto& cache = get_bitpacking_cache();
    if (auto* func = cache.find(ptype)) {
        return *func;
    }
    return cache.insert(ptype, BitpackingFun::GetFunction(ptype));
}

// DBConfig compression function lookups
optional_ptr<const CompressionFunction> DBConfig::TryGetCompressionFunction(CompressionType type, PhysicalType ptype) const {
    if (type == CompressionType::COMPRESSION_UNCOMPRESSED) {
        return &GetOrCreateUncompressed(ptype);
    }
    if (type == CompressionType::COMPRESSION_CONSTANT && ConstantFun::TypeIsSupported(ptype)) {
        return &GetOrCreateConstant(ptype);
    }
    return nullptr;
}

reference<const CompressionFunction> DBConfig::GetCompressionFunction(CompressionType type, PhysicalType ptype) const {
    if (type == CompressionType::COMPRESSION_CONSTANT && ConstantFun::TypeIsSupported(ptype)) {
        return GetOrCreateConstant(ptype);
    }
    // Default to uncompressed
    return GetOrCreateUncompressed(ptype);
}

vector<reference<const CompressionFunction>> DBConfig::GetCompressionFunctions(PhysicalType ptype) const {
    vector<reference<const CompressionFunction>> result;

    // Add uncompressed (always available)
    result.push_back(GetOrCreateUncompressed(ptype));

    // Add constant if supported
    if (ConstantFun::TypeIsSupported(ptype)) {
        result.push_back(GetOrCreateConstant(ptype));
    }

    // Add RLE if supported
    if (RLEFun::TypeIsSupported(ptype)) {
        result.push_back(GetOrCreateRLE(ptype));
    }

    // Add Bitpacking if supported
    if (BitpackingFun::TypeIsSupported(ptype)) {
        result.push_back(GetOrCreateBitpacking(ptype));
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
