#pragma once

#include <cassert>
#include <cstdint>
#include <limits>

#include "dashql/utils/hash.h"

namespace dashql {

using CatalogEntryID = uint32_t;

/// An identifier annotated with an external id
struct ExternalObjectID {
    constexpr static CatalogEntryID KEYWORD_EXTERNAL_ID = 0xFFFFFFFF;

   protected:
    /// The external id
    CatalogEntryID external_id;
    /// The value
    uint32_t value;

   public:
    /// Constructor
    ExternalObjectID()
        : external_id(std::numeric_limits<uint32_t>::max()), value(std::numeric_limits<uint32_t>::max()) {}
    /// Constructor
    explicit ExternalObjectID(uint32_t origin, uint32_t value) : external_id(origin), value(value) {}
    /// Get the external identifier
    inline uint32_t GetOrigin() const { return external_id; }
    /// Get the index
    inline uint32_t GetObject() const { return value; }
    /// Is a null id?
    inline bool IsNull() const { return GetObject() == std::numeric_limits<uint32_t>::max(); }
    /// Is a null id?
    inline uint64_t Pack() const { return (static_cast<uint64_t>(external_id) << 32) | value; }
    /// Is a null id?
    inline static ExternalObjectID Unpack(uint64_t packed) {
        ExternalObjectID out;
        out.external_id = ((packed >> 32) & 0xFFFFFFFF);
        out.value = (packed & 0xFFFFFFFF);
        return out;
    }

    /// Comparison
    bool operator==(const ExternalObjectID& other) const {
        return external_id == other.external_id && value == other.value;
    }
    /// Comparison
    bool operator<(const ExternalObjectID& other) const {
        return external_id < other.external_id || (external_id == other.external_id && value < other.value);
    }
    /// A hasher
    struct Hasher {
        size_t operator()(const ExternalObjectID& key) const {
            size_t hash = 0;
            hash_combine(hash, key.external_id);
            hash_combine(hash, key.value);
            return hash;
        }
    };
};
}  // namespace dashql

namespace std {
template <> struct hash<dashql::ExternalObjectID> {
    size_t operator()(const dashql::ExternalObjectID& key) const { return dashql::ExternalObjectID::Hasher{}(key); }
};
template <> struct hash<std::pair<dashql::ExternalObjectID, uint32_t>> {
    size_t operator()(const std::pair<dashql::ExternalObjectID, uint32_t>& key) const {
        size_t value = 0;
        dashql::hash_combine(value, std::get<0>(key));
        dashql::hash_combine(value, std::get<1>(key));
        return value;
    }
};
}  // namespace std
