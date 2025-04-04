#pragma once

#include <flatbuffers/buffer.h>
#include <flatbuffers/flatbuffer_builder.h>

#include <functional>
#include <limits>
#include <optional>
#include <span>
#include <string_view>
#include <tuple>
#include <variant>

#include "dashql/catalog_object.h"
#include "dashql/external.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/text/names.h"
#include "dashql/utils/btree/map.h"
#include "dashql/utils/btree/set.h"
#include "dashql/utils/chunk_buffer.h"
#include "dashql/utils/string_conversion.h"

namespace dashql {

class Catalog;
class Script;
class AnalyzedScript;
using CatalogDatabaseID = uint32_t;
using CatalogSchemaID = uint32_t;

constexpr uint32_t PROTO_NULL_U32 = std::numeric_limits<uint32_t>::max();
constexpr CatalogDatabaseID INITIAL_DATABASE_ID = 1 << 8;
constexpr CatalogSchemaID INITIAL_SCHEMA_ID = 1 << 16;

/// A schema stores database metadata.
/// It is used as a virtual container to expose table and column information to the analyzer.
class CatalogEntry {
    friend class Catalog;
    friend class Script;
    friend class ScriptCursor;

   public:
    using NameID = uint32_t;
    using Rank = uint32_t;

    using NameSearchIndex = btree::multimap<fuzzy_ci_string_view, std::reference_wrapper<const RegisteredName>>;

    /// A key for a qualified table name
    /// A qualified table name
    struct QualifiedTableName {
        using Key = std::tuple<std::string_view, std::string_view, std::string_view>;
        /// The AST node id in the target script
        std::optional<uint32_t> ast_node_id;
        /// The database name, may refer to different context
        std::reference_wrapper<RegisteredName> database_name;
        /// The schema name, may refer to different context
        std::reference_wrapper<RegisteredName> schema_name;
        /// The table name, may refer to different context
        std::reference_wrapper<RegisteredName> table_name;
        /// Constructor
        QualifiedTableName(std::optional<uint32_t> ast_node_id, RegisteredName& database_name,
                           RegisteredName& schema_name, RegisteredName& table_name)
            : ast_node_id(ast_node_id),
              database_name(database_name),
              schema_name(schema_name),
              table_name(table_name) {}
        /// Copy assignment
        QualifiedTableName& operator=(const QualifiedTableName& other) {
            ast_node_id = other.ast_node_id;
            database_name = other.database_name;
            schema_name = other.schema_name;
            table_name = other.table_name;
            return *this;
        }
        /// Pack as FlatBuffer
        flatbuffers::Offset<buffers::QualifiedTableName> Pack(flatbuffers::FlatBufferBuilder& builder) const;
        /// Construct a key
        operator Key() { return {database_name.get().text, schema_name.get().text, table_name.get().text}; }
    };
    /// A qualified column name
    struct QualifiedColumnName {
        using Key = std::pair<std::string_view, std::string_view>;
        /// The AST node id in the target script
        std::optional<uint32_t> ast_node_id;
        /// The table alias
        std::optional<std::reference_wrapper<RegisteredName>> table_alias;
        /// The column name
        std::reference_wrapper<RegisteredName> column_name;
        /// Constructor
        QualifiedColumnName(std::optional<uint32_t> ast_node_id,
                            std::optional<std::reference_wrapper<RegisteredName>> table_alias,
                            RegisteredName& column_name)
            : ast_node_id(ast_node_id), table_alias(table_alias), column_name(column_name) {}
        /// Pack as FlatBuffer
        flatbuffers::Offset<buffers::QualifiedColumnName> Pack(flatbuffers::FlatBufferBuilder& builder) const;
        /// Construct a key
        operator Key() {
            return {table_alias.has_value() ? table_alias.value().get().text : "", column_name.get().text};
        }
    };
    /// Forward declare the table
    struct TableDeclaration;
    /// A table column
    struct TableColumn : public CatalogObject {
        /// The parent table
        std::optional<std::reference_wrapper<TableDeclaration>> table;
        /// The catalog database id
        uint32_t column_index = 0;
        /// The AST node id in the target script
        std::optional<uint32_t> ast_node_id;
        /// The column name
        std::reference_wrapper<RegisteredName> column_name;
        /// Constructor
        TableColumn(std::optional<uint32_t> ast_node_id, RegisteredName& column_name)
            : CatalogObject(CatalogObjectType::ColumnDeclaration), ast_node_id(ast_node_id), column_name(column_name) {}
        /// Pack as FlatBuffer
        flatbuffers::Offset<buffers::TableColumn> Pack(flatbuffers::FlatBufferBuilder& builder) const;
    };
    /// A table declaration
    struct TableDeclaration : public CatalogObject {
        /// The catalog database id
        CatalogDatabaseID catalog_database_id = 0;
        /// The catalog schema id
        CatalogSchemaID catalog_schema_id = 0;
        /// The catalog database id
        ContextObjectID catalog_table_id;
        /// The database reference id
        size_t database_reference_id = 0;
        /// The schema reference id
        size_t schema_reference_id = 0;
        /// The AST node id in the target script
        std::optional<uint32_t> ast_node_id;
        /// The AST statement id in the target script
        std::optional<uint32_t> ast_statement_id;
        /// The AST scope root id in the target script
        std::optional<uint32_t> ast_scope_root;
        /// The table name
        QualifiedTableName table_name;
        /// The table columns
        std::vector<TableColumn> table_columns;
        /// A mini hash map of all columns.
        /// Maintaining this spares us from loading all table columns into a naming scope
        ankerl::unordered_dense::map<std::string_view, std::reference_wrapper<TableColumn>> table_columns_by_name;

        /// Constructor
        TableDeclaration(QualifiedTableName table_name)
            : CatalogObject(CatalogObjectType::TableDeclaration), table_name(std::move(table_name)) {}
        /// Pack as FlatBuffer
        flatbuffers::Offset<buffers::Table> Pack(flatbuffers::FlatBufferBuilder& builder) const;
    };
    /// A database name declaration
    struct DatabaseReference : public CatalogObject {
        /// The catalog database id.
        /// This ID is only preliminary if the entry has not been added to the catalog yet.
        /// Adding the entry to the catalog might fail if this id becomes invalid.
        CatalogDatabaseID catalog_database_id;
        /// The database name
        std::string_view database_name;
        /// The database alias (if any)
        std::string_view database_alias;
        /// Constructor
        DatabaseReference(CatalogDatabaseID database_id, std::string_view database_name,
                          std::string_view database_alias)
            : CatalogObject(CatalogObjectType::DatabaseReference),
              catalog_database_id(database_id),
              database_name(database_name),
              database_alias(database_alias) {}
        /// Pack as FlatBuffer
        flatbuffers::Offset<buffers::DatabaseDeclaration> Pack(flatbuffers::FlatBufferBuilder& builder) const;
    };
    /// A schema name declaration
    struct SchemaReference : public CatalogObject {
        /// The catalog database id
        /// This ID is only preliminary if the entry has not been added to the catalog yet.
        /// Adding the entry to the catalog might fail if this id becomes invalid.
        CatalogDatabaseID catalog_database_id;
        /// The catalog schema id.
        /// This ID is only preliminary if the entry has not been added to the catalog yet.
        /// Adding the entry to the catalog might fail if this id becomes invalid.
        CatalogSchemaID catalog_schema_id;
        /// The database name
        std::string_view database_name;
        /// The schema name
        std::string_view schema_name;
        /// Constructor
        SchemaReference(CatalogDatabaseID database_id, CatalogSchemaID schema_id, std::string_view database_name,
                        std::string_view schema_name)
            : CatalogObject(CatalogObjectType::SchemaReference),
              catalog_database_id(database_id),
              catalog_schema_id(schema_id),
              database_name(database_name),
              schema_name(schema_name) {}
        /// Pack as FlatBuffer
        flatbuffers::Offset<buffers::SchemaDeclaration> Pack(flatbuffers::FlatBufferBuilder& builder) const;
    };

   protected:
    /// The catalog
    Catalog& catalog;
    /// The catalog entry id
    const CatalogEntryID catalog_entry_id;
    /// The referenced databases
    ChunkBuffer<DatabaseReference, 16> database_references;
    /// The referenced schemas
    ChunkBuffer<SchemaReference, 16> schema_references;
    /// The table definitions
    ChunkBuffer<TableDeclaration, 16> table_declarations;
    /// The databases, indexed by name
    std::unordered_map<std::string_view, std::reference_wrapper<const DatabaseReference>> databases_by_name;
    /// The schema, indexed by name
    btree::map<std::pair<std::string_view, std::string_view>, std::reference_wrapper<const SchemaReference>>
        schemas_by_name;
    /// The tables, indexed by name
    btree::map<QualifiedTableName::Key, std::reference_wrapper<const TableDeclaration>> tables_by_name;
    /// The table columns, indexed by the name
    std::unordered_multimap<std::string_view, std::reference_wrapper<const TableColumn>> table_columns_by_name;
    /// The name search index
    std::optional<CatalogEntry::NameSearchIndex> name_search_index;

   public:
    /// Construcutor
    CatalogEntry(Catalog& catalog, CatalogEntryID external_id);

    /// Get the external id
    CatalogEntryID GetCatalogEntryId() const { return catalog_entry_id; }
    /// Get the database declarations
    auto& GetDatabases() const { return database_references; }
    /// Get the database declarations by name
    auto& GetDatabasesByName() const { return databases_by_name; }
    /// Get the schema declarations
    auto& GetSchemas() const { return schema_references; }
    /// Get the schema declarations by name
    auto& GetSchemasByName() const { return schemas_by_name; }
    /// Get the table declarations
    auto& GetTables() const { return table_declarations; }
    /// Get the table declarations by name
    auto& GetTablesByName() const { return tables_by_name; }
    /// Get the table columns by name
    auto& GetTableColumnsByName() const { return table_columns_by_name; }

    /// Get the qualified name
    QualifiedTableName QualifyTableName(NameRegistry& name_registry, QualifiedTableName name) const;

    /// Describe the catalog entry
    virtual flatbuffers::Offset<buffers::CatalogEntry> DescribeEntry(flatbuffers::FlatBufferBuilder& builder) const = 0;
    /// Get the name search index
    virtual const NameSearchIndex& GetNameSearchIndex() = 0;

    /// Resolve a database reference
    void ResolveDatabaseSchemasWithCatalog(
        std::string_view database_name,
        std::vector<std::pair<std::reference_wrapper<const SchemaReference>, bool>>& out) const;
    /// Find table columns by name
    void ResolveSchemaTablesWithCatalog(
        std::string_view database_name, std::string_view schema_name,
        std::vector<std::pair<std::reference_wrapper<const CatalogEntry::TableDeclaration>, bool>>& out) const;
    /// Resolve a table by id
    const TableDeclaration* ResolveTable(ContextObjectID table_id) const;
    /// Resolve a table by id
    const TableDeclaration* ResolveTableWithCatalog(ContextObjectID table_id) const;
    /// Resolve a table by name
    const TableDeclaration* ResolveTable(QualifiedTableName table_name) const;
    /// Resolve a table by name
    const TableDeclaration* ResolveTableWithCatalog(QualifiedTableName table_name) const;
    /// Find table columns by name
    void ResolveTableColumns(std::string_view table_column, std::vector<TableColumn>& out) const;
    /// Find table columns by name
    void ResolveTableColumnsWithCatalog(std::string_view table_column, std::vector<TableColumn>& out) const;
};

class DescriptorPool : public CatalogEntry {
   public:
    /// A reference to a flatbuffer descriptor
    using DescriptorRefVariant = std::variant<std::reference_wrapper<const buffers::SchemaDescriptor>,
                                              std::reference_wrapper<const buffers::SchemaDescriptors>>;
    /// A schema descriptors
    struct Descriptor {
        /// The schema descriptor
        DescriptorRefVariant descriptor;
        /// The descriptor buffer
        std::unique_ptr<const std::byte[]> descriptor_buffer;
        /// The descriptor buffer size
        size_t descriptor_buffer_size;
    };

   protected:
    /// The rank
    Rank rank;
    /// The schema descriptors
    std::vector<Descriptor> descriptor_buffers;
    /// The name registry
    NameRegistry name_registry;

   public:
    /// Construcutor
    DescriptorPool(Catalog& catalog, CatalogEntryID external_id, Rank rank);
    /// Get the rank
    auto GetRank() const { return rank; }

    /// Describe the catalog entry
    flatbuffers::Offset<buffers::CatalogEntry> DescribeEntry(flatbuffers::FlatBufferBuilder& builder) const override;
    /// Get the name search index
    const NameSearchIndex& GetNameSearchIndex() override;
    /// Get the name registry
    const NameRegistry& GetNameRegistry() const { return name_registry; }
    /// Get the descriptors
    std::span<const Descriptor> GetDescriptors() const { return descriptor_buffers; }

    /// Add a schema descriptor
    buffers::StatusCode AddSchemaDescriptor(DescriptorRefVariant descriptor,
                                          std::unique_ptr<const std::byte[]> descriptor_buffer,
                                          size_t descriptor_buffer_size, CatalogDatabaseID& db_id,
                                          CatalogSchemaID& schema_id);
};

class Catalog {
    friend class CatalogEntry;

   public:
    using Version = uint64_t;

    /// The default database name
    constexpr static std::string_view DEFAULT_DATABASE_NAME = "dashql";
    /// The default schema name
    constexpr static std::string_view DEFAULT_SCHEMA_NAME = "public";

   protected:
    /// A catalog entry backed by an analyzed script
    struct ScriptEntry {
        /// The script
        const Script& script;
        /// The analyzed script
        std::shared_ptr<AnalyzedScript> analyzed;
        /// The current rank
        CatalogEntry::Rank rank;
    };
    /// Information about a catalog entry referenced through the schema name
    struct CatalogSchemaEntryInfo {
        /// The id of the catalog entry
        CatalogEntryID catalog_entry_id;
        /// The id of the database <catalog_entry_id, database_idx>
        CatalogDatabaseID catalog_database_id;
        /// The id of the schema <catalog_entry_id, schema_idx>
        CatalogSchemaID catalog_schema_id;
    };

   public:
    /// A database declaration
    struct DatabaseDeclaration : public CatalogEntry::DatabaseReference {
        /// The database name
        std::string database_name_buffer;
        /// The database alias (if any)
        std::string database_alias_buffer;
        /// Constructor
        DatabaseDeclaration(CatalogDatabaseID database_id, std::string_view database_name,
                            std::string_view database_alias)
            : CatalogEntry::DatabaseReference(database_id, "", ""),
              database_name_buffer(std::move(database_name)),
              database_alias_buffer(std::move(database_alias)) {
            this->database_name = database_name_buffer;
            this->database_alias = database_alias_buffer;
        }
        /// Move constructor
        DatabaseDeclaration(DatabaseDeclaration&&) = default;
        /// Move assignment
        DatabaseDeclaration& operator=(DatabaseDeclaration&&) = default;
    };
    /// A schema declaration
    struct SchemaDeclaration : public CatalogEntry::SchemaReference {
        /// The schema name
        std::string schema_name_buffer;
        /// Constructor
        SchemaDeclaration(CatalogDatabaseID database_id, CatalogSchemaID schema_id, std::string_view database_name,
                          std::string_view schema_name)
            : CatalogEntry::SchemaReference(database_id, schema_id, database_name, ""),
              schema_name_buffer(std::move(schema_name)) {
            this->schema_name = schema_name_buffer;
        }
        /// Move constructor
        SchemaDeclaration(SchemaDeclaration&&) = default;
        /// Move assignment
        SchemaDeclaration& operator=(SchemaDeclaration&&) = default;
    };

   protected:
    /// The catalog version.
    /// Every modification bumps the version counter, the analyzer reads the version counter which protects all refs.
    Version version = 1;
    /// The default database name
    const std::string default_database_name;
    /// The default schema name
    const std::string default_schema_name;

    /// The catalog entries
    std::unordered_map<CatalogEntryID, CatalogEntry*> entries;
    /// The script entries
    std::unordered_map<Script*, ScriptEntry> script_entries;
    /// The descriptor pool entries
    std::unordered_map<CatalogEntryID, std::unique_ptr<DescriptorPool>> descriptor_pool_entries;
    /// The entries ordered by <rank>
    btree::set<std::tuple<CatalogEntry::Rank, CatalogEntryID>> entries_ranked;
    /// The entries ordered by <database, schema, rank>
    btree::map<std::tuple<std::string_view, std::string_view, CatalogEntry::Rank, CatalogEntryID>,
               CatalogSchemaEntryInfo>
        entries_by_schema;

    /// The next database id
    CatalogDatabaseID next_database_id = INITIAL_DATABASE_ID;
    /// The next schema id
    CatalogSchemaID next_schema_id = INITIAL_SCHEMA_ID;
    /// The databases.
    /// The btrees contain all the databases that are currently referenced by catalog entries.
    btree::map<std::string_view, std::unique_ptr<DatabaseDeclaration>> databases;
    /// The schemas.
    /// These btrees contain all the schemas that are currently referenced by catalog entries.
    /// Ordered by <database, schema>
    btree::map<std::pair<std::string_view, std::string_view>, std::unique_ptr<SchemaDeclaration>> schemas;

    /// Update a script entry
    buffers::StatusCode UpdateScript(ScriptEntry& entry);

   public:
    /// Explicit constructor needed due to deleted copy constructor
    Catalog(std::string_view default_database_name = DEFAULT_DATABASE_NAME,
            std::string_view default_schema_name = DEFAULT_SCHEMA_NAME);
    /// Catalogs must not be copied
    Catalog(const Catalog& other) = delete;
    /// Catalogs must not be copy-assigned
    Catalog& operator=(const Catalog& other) = delete;

    /// Get the current version of the registry
    uint64_t GetVersion() const { return version; }
    /// Get the default database name
    std::string_view GetDefaultDatabaseName() const { return default_database_name; }
    /// Get the default schema name
    std::string_view GetDefaultSchemaName() const { return default_schema_name; }
    /// Get the databases
    auto& GetDatabases() const { return databases; }
    /// Get the schemas ordered by <database, schema>
    auto& GetSchemas() const { return schemas; }

    /// Contains an entry id?
    bool Contains(CatalogEntryID id) const { return entries.contains(id); }
    /// Iterate all entries in arbitrary order
    template <typename Fn> void Iterate(Fn f) const {
        for (auto& [entry_id, entry] : entries) {
            f(entry_id, *entry);
        }
    }
    /// Iterate entries in ranked order
    template <typename Fn> void IterateRanked(Fn f) const {
        for (auto& [rank, id] : entries_ranked) {
            auto* entry = entries.at(id);
            f(id, *entry, rank);
        }
    }
    /// Register a database name
    CatalogDatabaseID AllocateDatabaseId(std::string_view database) {
        auto iter = databases.find(database);
        if (iter != databases.end()) {
            return iter->second->catalog_database_id;
        } else {
            return next_database_id++;
        }
    }
    /// Register a schema name
    CatalogSchemaID AllocateSchemaId(std::string_view database, std::string_view schema) {
        auto iter = schemas.find({database, schema});
        if (iter != schemas.end()) {
            return iter->second->catalog_schema_id;
        } else {
            return next_schema_id++;
        }
    }

    /// Clear a catalog
    void Clear();
    /// Describe catalog entries
    flatbuffers::Offset<buffers::CatalogEntries> DescribeEntries(flatbuffers::FlatBufferBuilder& builder) const;
    /// Describe catalog entries
    flatbuffers::Offset<buffers::CatalogEntries> DescribeEntriesOf(flatbuffers::FlatBufferBuilder& builder,
                                                                 size_t external_id) const;
    /// Flatten the catalog
    flatbuffers::Offset<buffers::FlatCatalog> Flatten(flatbuffers::FlatBufferBuilder& builder) const;

    /// Add a script
    buffers::StatusCode LoadScript(Script& script, CatalogEntry::Rank rank);
    /// Drop a script
    void DropScript(Script& script);
    /// Add a descriptor pool
    buffers::StatusCode AddDescriptorPool(CatalogEntryID external_id, CatalogEntry::Rank rank);
    /// Drop a descriptor pool
    buffers::StatusCode DropDescriptorPool(CatalogEntryID external_id);
    /// Add a schema descriptor as serialized FlatBuffer
    buffers::StatusCode AddSchemaDescriptor(CatalogEntryID external_id, std::span<const std::byte> descriptor_data,
                                          std::unique_ptr<const std::byte[]> descriptor_buffer,
                                          size_t descriptor_buffer_size);
    /// Add a schema descriptor>s< as serialized FlatBuffer
    buffers::StatusCode AddSchemaDescriptors(CatalogEntryID external_id, std::span<const std::byte> descriptor_data,
                                           std::unique_ptr<const std::byte[]> descriptor_buffer,
                                           size_t descriptor_buffer_size);

    /// Resolve a table by id
    const CatalogEntry::TableDeclaration* ResolveTable(ContextObjectID table_id) const;
    /// Resolve a table by id
    const CatalogEntry::TableDeclaration* ResolveTable(CatalogEntry::QualifiedTableName table_name,
                                                       CatalogEntryID ignore_entry) const;
    /// Resolve all schema tables
    void ResolveSchemaTables(std::string_view database_name, std::string_view schema_name,
                             std::vector<std::reference_wrapper<const CatalogEntry::TableDeclaration>>& out) const;
    /// Get statisics
    std::unique_ptr<buffers::CatalogStatisticsT> GetStatistics();
};

}  // namespace dashql
