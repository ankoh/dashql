#pragma once

#include "dashql/buffers/index_generated.h"
#include "dashql/external.h"
#include "dashql/utils/intrusive_list.h"

namespace dashql {

/// A type of a catalog object
enum CatalogObjectType {
    Deferred = 0,
    DatabaseReference = 1,
    SchemaReference = 2,
    TableDeclaration = 3,
    ColumnDeclaration = 4,
};
static_assert(static_cast<uint8_t>(buffers::completion::CompletionCandidateObjectType::COLUMN) ==
              CatalogObjectType::ColumnDeclaration);
static_assert(static_cast<uint8_t>(buffers::completion::CompletionCandidateObjectType::DATABASE) ==
              CatalogObjectType::DatabaseReference);
static_assert(static_cast<uint8_t>(buffers::completion::CompletionCandidateObjectType::SCHEMA) ==
              CatalogObjectType::SchemaReference);
static_assert(static_cast<uint8_t>(buffers::completion::CompletionCandidateObjectType::TABLE) ==
              CatalogObjectType::TableDeclaration);

using CatalogDatabaseID = uint32_t;
using CatalogSchemaID = uint32_t;
using CatalogEntryID = uint32_t;
using CatalogTableID = ExternalObjectID;
using CatalogVersion = uint32_t;

/// An id for a catalog object
struct QualifiedCatalogObjectID {
   protected:
    /// The part 0
    uint64_t part0;
    /// The part 1
    uint32_t part1;
    /// The type
    CatalogObjectType type;

    /// The constructor
    QualifiedCatalogObjectID(CatalogObjectType type, uint64_t part0, uint32_t part1 = 0)
        : type(type), part0(part0), part1(part1) {}

   public:
    /// Default constructor
    QualifiedCatalogObjectID() : type(CatalogObjectType::Deferred), part0(0), part1(0) {}
    /// Copy constructor
    QualifiedCatalogObjectID(const QualifiedCatalogObjectID& other) = default;
    /// Copy assignment
    QualifiedCatalogObjectID& operator=(const QualifiedCatalogObjectID& other) = default;

    /// A database
    static QualifiedCatalogObjectID Deferred() { return QualifiedCatalogObjectID(CatalogObjectType::Deferred, 0, 0); }
    /// A database
    static QualifiedCatalogObjectID Database(CatalogDatabaseID database_id) {
        return QualifiedCatalogObjectID(CatalogObjectType::DatabaseReference, database_id);
    }
    /// A schema
    static QualifiedCatalogObjectID Schema(CatalogDatabaseID database_id, CatalogSchemaID schema_id) {
        return QualifiedCatalogObjectID(CatalogObjectType::SchemaReference, database_id, schema_id);
    }
    /// A table
    static QualifiedCatalogObjectID Table(CatalogTableID table_id) {
        return QualifiedCatalogObjectID(CatalogObjectType::TableDeclaration, table_id.Pack());
    }
    /// A table column
    static QualifiedCatalogObjectID TableColumn(CatalogTableID table_id, uint32_t column_id) {
        return QualifiedCatalogObjectID(CatalogObjectType::ColumnDeclaration, table_id.Pack(), column_id);
    }
    /// Unpack a database id
    CatalogDatabaseID UnpackDatabaseID() const {
        assert(type == CatalogObjectType::DatabaseReference);
        return static_cast<CatalogDatabaseID>(part0);
    }
    /// Unpack a schema id
    std::pair<CatalogDatabaseID, CatalogSchemaID> UnpackSchemaID() const {
        assert(type == CatalogObjectType::SchemaReference);
        return {static_cast<CatalogDatabaseID>(part0), static_cast<CatalogSchemaID>(part1)};
    }
    /// Unpack a table id
    CatalogTableID UnpackTableID() const {
        assert(type == CatalogObjectType::TableDeclaration);
        return CatalogTableID::Unpack(part0);
    }
    /// Unpack a table column id
    std::pair<CatalogTableID, uint32_t> UnpackTableColumnID() const {
        assert(type == CatalogObjectType::ColumnDeclaration);
        return {CatalogTableID::Unpack(part0), part1};
    }

    /// Equality operator
    bool operator==(const QualifiedCatalogObjectID& other) const {
        return type == other.type && part0 == other.part0 && part1 == other.part1;
    }
    /// Inequality operator
    bool operator!=(const QualifiedCatalogObjectID& other) const { return !(*this == other); }

    /// Less than operator
    bool operator<(const QualifiedCatalogObjectID& other) const {
        if (type != other.type) return type < other.type;
        if (part0 != other.part0) return part0 < other.part0;
        return part1 < other.part1;
    }
    /// Less than or equal operator
    bool operator<=(const QualifiedCatalogObjectID& other) const { return *this < other || *this == other; }
    /// Greater than operator
    bool operator>(const QualifiedCatalogObjectID& other) const { return other < *this; }
    /// Greater than or equal operator
    bool operator>=(const QualifiedCatalogObjectID& other) const { return !(*this < other); }

    /// Get the type
    CatalogObjectType GetType() const { return type; }

    /// Friend the hash function to access private members
    friend struct std::hash<QualifiedCatalogObjectID>;
};

/// A catalog object
struct CatalogObject : public IntrusiveListNode {
    /// The object id
    QualifiedCatalogObjectID object_id;
    /// Constructor
    CatalogObject(QualifiedCatalogObjectID id) : IntrusiveListNode(), object_id(id) {}

    /// Get the object type
    CatalogObjectType GetObjectType() const { return object_id.GetType(); }
    /// Cast to monostate object
    const CatalogObject& CastToBase() const { return *reinterpret_cast<const CatalogObject*>(this); }
    /// Cast to monostate object
    CatalogObject& CastToBase() { return *reinterpret_cast<CatalogObject*>(this); }
    /// Cast unsafely to specific child object
    template <typename T, typename std::enable_if<std::is_base_of<CatalogObject, T>::value>::type* = nullptr>
    const T& CastUnsafe() const {
        return *reinterpret_cast<const T*>(this);
    }
};

}  // namespace dashql

namespace std {
template <> struct hash<dashql::QualifiedCatalogObjectID> {
    size_t operator()(const dashql::QualifiedCatalogObjectID& key) const {
        size_t hash = 0;
        dashql::hash_combine(hash, static_cast<uint32_t>(key.type));
        dashql::hash_combine(hash, key.part0);
        dashql::hash_combine(hash, key.part1);
        return hash;
    }
};
}  // namespace std
