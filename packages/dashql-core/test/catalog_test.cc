#include "dashql/catalog.h"

#include <flatbuffers/buffer.h>
#include <flatbuffers/flatbuffer_builder.h>

#include "dashql/analyzer/analyzer.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog_object.h"
#include "dashql/script.h"
#include "gtest/gtest.h"

using namespace dashql;

namespace {

struct SchemaTableColumn {
    std::string column_name;
};

struct SchemaTable {
    std::string table_name;
    std::vector<SchemaTableColumn> table_columns;
};

struct Schema {
    std::string database_name;
    std::string schema_name;
    std::vector<SchemaTable> tables;
};

std::tuple<std::span<const std::byte>, std::unique_ptr<const std::byte[]>, size_t> PackSchema(const Schema& schema) {
    flatbuffers::FlatBufferBuilder fbb;
    auto database_name = fbb.CreateString(schema.database_name);
    auto schema_name = fbb.CreateString(schema.schema_name);
    std::vector<flatbuffers::Offset<buffers::catalog::SchemaTable>> tables;
    std::vector<flatbuffers::Offset<buffers::catalog::SchemaTableColumn>> table_columns;
    for (auto& table : schema.tables) {
        table_columns.clear();
        for (auto& column : table.table_columns) {
            auto column_name = fbb.CreateString(column.column_name);
            buffers::catalog::SchemaTableColumnBuilder column_builder{fbb};
            column_builder.add_column_name(column_name);
            table_columns.push_back(column_builder.Finish());
        }
        auto table_columns_ofs = fbb.CreateVector(table_columns);
        auto table_name_ofs = fbb.CreateString(table.table_name);
        buffers::catalog::SchemaTableBuilder table_builder{fbb};
        table_builder.add_table_name(table_name_ofs);
        table_builder.add_columns(table_columns_ofs);
        tables.push_back(table_builder.Finish());
    }
    auto tables_ofs = fbb.CreateVector(tables);
    buffers::catalog::SchemaDescriptorBuilder descriptor_builder{fbb};
    descriptor_builder.add_database_name(database_name);
    descriptor_builder.add_schema_name(schema_name);
    descriptor_builder.add_tables(tables_ofs);
    fbb.Finish(descriptor_builder.Finish());
    size_t buffer_size = 0;
    size_t buffer_offset = 0;
    auto buffer = fbb.ReleaseRaw(buffer_size, buffer_offset);
    auto buffer_owned = std::unique_ptr<const std::byte[]>(reinterpret_cast<const std::byte*>(buffer));
    std::span<const std::byte> data_span{buffer_owned.get() + buffer_offset, buffer_size - buffer_offset};
    return {data_span, std::move(buffer_owned), buffer_size};
}

TEST(CatalogTest, Clear) {
    Catalog catalog;
    ASSERT_EQ(catalog.AddDescriptorPool(1, 10), buffers::status::StatusCode::OK);

    auto [descriptor, descriptor_buffer, descriptor_buffer_size] = PackSchema(Schema{
        .database_name = "db1",
        .schema_name = "schema1",
        .tables = {SchemaTable{
            .table_name = "table1",
            .table_columns = {SchemaTableColumn{.column_name = "column1"}, SchemaTableColumn{.column_name = "column2"},
                              SchemaTableColumn{.column_name = "column3"}}}},
    });
    auto status = catalog.AddSchemaDescriptor(1, descriptor, std::move(descriptor_buffer), descriptor_buffer_size);
    ASSERT_EQ(status, buffers::status::StatusCode::OK);

    {
        flatbuffers::FlatBufferBuilder fb;
        fb.Finish(catalog.DescribeEntries(fb));
        auto description = flatbuffers::GetRoot<buffers::catalog::CatalogEntries>(fb.GetBufferPointer());
        ASSERT_EQ(description->entries()->size(), 1);
        ASSERT_EQ(description->entries()->Get(0)->catalog_entry_id(), 1);
        ASSERT_EQ(description->entries()->Get(0)->catalog_entry_type(),
                  buffers::catalog::CatalogEntryType::DESCRIPTOR_POOL);
    }
    catalog.Clear();
    {
        flatbuffers::FlatBufferBuilder fb;
        fb.Finish(catalog.DescribeEntries(fb));
        auto description = flatbuffers::GetRoot<buffers::catalog::CatalogEntries>(fb.GetBufferPointer());
        ASSERT_EQ(description->entries()->size(), 0);
    }
}

TEST(CatalogTest, SingleDescriptorPool) {
    Catalog catalog;
    ASSERT_EQ(catalog.AddDescriptorPool(1, 10), buffers::status::StatusCode::OK);

    auto [descriptor, descriptor_buffer, descriptor_buffer_size] = PackSchema(Schema{
        .database_name = "db1",
        .schema_name = "schema1",
        .tables = {SchemaTable{
            .table_name = "table1",
            .table_columns = {SchemaTableColumn{.column_name = "column1"}, SchemaTableColumn{.column_name = "column2"},
                              SchemaTableColumn{.column_name = "column3"}}}},
    });
    auto status = catalog.AddSchemaDescriptor(1, descriptor, std::move(descriptor_buffer), descriptor_buffer_size);
    ASSERT_EQ(status, buffers::status::StatusCode::OK);

    {
        flatbuffers::FlatBufferBuilder fb;
        fb.Finish(catalog.DescribeEntries(fb));
        auto description = flatbuffers::GetRoot<buffers::catalog::CatalogEntries>(fb.GetBufferPointer());
        ASSERT_EQ(description->entries()->size(), 1);
        ASSERT_EQ(description->entries()->Get(0)->catalog_entry_id(), 1);
        ASSERT_EQ(description->entries()->Get(0)->catalog_entry_type(),
                  buffers::catalog::CatalogEntryType::DESCRIPTOR_POOL);
    }

    Script script{catalog, 2};
    {
        script.ReplaceText("select * from db1.schema1.table1");
        ASSERT_EQ(script.Scan(), buffers::status::StatusCode::OK);
        ASSERT_EQ(script.Parse(), buffers::status::StatusCode::OK);
        ASSERT_EQ(script.Analyze(), buffers::status::StatusCode::OK);
        auto& analyzed = script.GetAnalyzedScript();
        ASSERT_EQ(analyzed->table_references.GetSize(), 1);
        ASSERT_TRUE(std::holds_alternative<AnalyzedScript::TableReference::RelationExpression>(
            analyzed->table_references[0].inner));
        auto& rel_expr =
            std::get<AnalyzedScript::TableReference::RelationExpression>(analyzed->table_references[0].inner);
        ASSERT_TRUE(rel_expr.resolved_table.has_value());
        auto& resolved = rel_expr.resolved_table.value();
        ASSERT_EQ(resolved.catalog_table_id.GetType(), CatalogObjectType::TableDeclaration);
        ASSERT_EQ(resolved.catalog_table_id.UnpackTableID().GetContext(), 1);
        ASSERT_EQ(resolved.catalog_table_id.UnpackTableID().GetObject(), 0);
    }
    {
        script.ReplaceText("select * from db1.schema1.table2");
        ASSERT_EQ(script.Scan(), buffers::status::StatusCode::OK);
        ASSERT_EQ(script.Parse(), buffers::status::StatusCode::OK);
        ASSERT_EQ(script.Analyze(), buffers::status::StatusCode::OK);
        auto& analyzed = script.GetAnalyzedScript();
        ASSERT_EQ(analyzed->table_references.GetSize(), 1);
        ASSERT_TRUE(std::holds_alternative<AnalyzedScript::TableReference::RelationExpression>(
            analyzed->table_references[0].inner));
        auto& rel_expr =
            std::get<AnalyzedScript::TableReference::RelationExpression>(analyzed->table_references[0].inner);
        ASSERT_TRUE(!rel_expr.resolved_table.has_value());
    }
}

TEST(CatalogTest, DescriptorPoolIDCollision) {
    Catalog catalog;
    ASSERT_EQ(catalog.AddDescriptorPool(1, 10), buffers::status::StatusCode::OK);
    ASSERT_EQ(catalog.AddDescriptorPool(1, 10), buffers::status::StatusCode::EXTERNAL_ID_COLLISION);
}

TEST(CatalogTest, FlattenEmpty) {
    Catalog catalog;
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(catalog.Flatten(fb));
    auto flat = flatbuffers::GetRoot<buffers::catalog::FlatCatalog>(fb.GetBufferPointer());
    ASSERT_EQ(flat->catalog_version(), catalog.GetVersion());
}

TEST(CatalogTest, FlattenSingleDescriptorPool) {
    Catalog catalog;
    ASSERT_EQ(catalog.AddDescriptorPool(1, 10), buffers::status::StatusCode::OK);

    auto [descriptor, descriptor_buffer, descriptor_buffer_size] = PackSchema(Schema{
        .database_name = "db1",
        .schema_name = "schema1",
        .tables = {SchemaTable{.table_name = "table1",
                               .table_columns = {SchemaTableColumn{.column_name = "column1"},
                                                 SchemaTableColumn{.column_name = "column2"},
                                                 SchemaTableColumn{.column_name = "column3"}}

                   },
                   SchemaTable{.table_name = "table2",
                               .table_columns = {SchemaTableColumn{.column_name = "column1"},
                                                 SchemaTableColumn{.column_name = "column2"},
                                                 SchemaTableColumn{.column_name = "column4"}}

                   }},
    });
    auto status = catalog.AddSchemaDescriptor(1, descriptor, std::move(descriptor_buffer), descriptor_buffer_size);
    ASSERT_EQ(status, buffers::status::StatusCode::OK);

    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(catalog.Flatten(fb));
    auto flat = flatbuffers::GetRoot<buffers::catalog::FlatCatalog>(fb.GetBufferPointer());
    ASSERT_EQ(flat->catalog_version(), catalog.GetVersion());
    ASSERT_EQ(flat->databases()->size(), 1);
    ASSERT_EQ(flat->schemas()->size(), 1);
    ASSERT_EQ(flat->tables()->size(), 2);
    ASSERT_EQ(flat->columns()->size(), 6);
    ASSERT_EQ(flat->name_dictionary()->size(), 8);
}

TEST(CatalogTest, FlattenMultipleDatabases) {
    Catalog catalog;
    ASSERT_EQ(catalog.AddDescriptorPool(1, 10), buffers::status::StatusCode::OK);

    {
        auto [descriptor, descriptor_buffer, descriptor_buffer_size] = PackSchema(Schema{
            .database_name = "db1",
            .schema_name = "schema1",
            .tables = {SchemaTable{.table_name = "table1",
                                   .table_columns = {SchemaTableColumn{.column_name = "column1"},
                                                     SchemaTableColumn{.column_name = "column2"},
                                                     SchemaTableColumn{.column_name = "column3"}}

                       },
                       SchemaTable{.table_name = "table2",
                                   .table_columns = {SchemaTableColumn{.column_name = "column1"},
                                                     SchemaTableColumn{.column_name = "column2"},
                                                     SchemaTableColumn{.column_name = "column4"}}

                       }},
        });
        auto status = catalog.AddSchemaDescriptor(1, descriptor, std::move(descriptor_buffer), descriptor_buffer_size);
        ASSERT_EQ(status, buffers::status::StatusCode::OK);
    }
    {
        auto [descriptor, descriptor_buffer, descriptor_buffer_size] = PackSchema(Schema{
            .database_name = "db2",
            .schema_name = "schema1",
            .tables = {SchemaTable{.table_name = "table1",
                                   .table_columns = {SchemaTableColumn{.column_name = "column1"},
                                                     SchemaTableColumn{.column_name = "column2"},
                                                     SchemaTableColumn{.column_name = "column3"}}

                       },
                       SchemaTable{.table_name = "table2",
                                   .table_columns = {SchemaTableColumn{.column_name = "column1"},
                                                     SchemaTableColumn{.column_name = "column2"},
                                                     SchemaTableColumn{.column_name = "column4"}}

                       }},
        });
        auto status = catalog.AddSchemaDescriptor(1, descriptor, std::move(descriptor_buffer), descriptor_buffer_size);
        ASSERT_EQ(status, buffers::status::StatusCode::OK) << static_cast<uint32_t>(status);
    }

    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(catalog.Flatten(fb));
    auto flat = flatbuffers::GetRoot<buffers::catalog::FlatCatalog>(fb.GetBufferPointer());
    ASSERT_EQ(flat->catalog_version(), catalog.GetVersion());
    ASSERT_EQ(flat->databases()->size(), 2);
    ASSERT_EQ(flat->schemas()->size(), 2);
    ASSERT_EQ(flat->tables()->size(), 4);
    ASSERT_EQ(flat->columns()->size(), 12);
    ASSERT_EQ(flat->name_dictionary()->size(), 9);

    ASSERT_EQ(flat->databases()->Get(0)->flat_entry_idx(), 0);
    ASSERT_EQ(flat->databases()->Get(0)->child_begin(), 0);
    ASSERT_EQ(flat->databases()->Get(0)->child_count(), 1);
    ASSERT_EQ(flat->databases()->Get(1)->flat_entry_idx(), 1);
    ASSERT_EQ(flat->databases()->Get(1)->child_begin(), 1);
    ASSERT_EQ(flat->databases()->Get(1)->child_count(), 1);
    ASSERT_EQ(flat->schemas()->Get(0)->flat_parent_idx(), 0);
    ASSERT_EQ(flat->schemas()->Get(0)->flat_entry_idx(), 0);
    ASSERT_EQ(flat->schemas()->Get(1)->flat_parent_idx(), 1);
    ASSERT_EQ(flat->schemas()->Get(1)->flat_entry_idx(), 1);
}

constexpr std::string_view TPCH_SCHEMA = R"SQL(
create table part (
   p_partkey integer not null,
   p_name varchar(55) not null,
   p_mfgr char(25) not null,
   p_brand char(10) not null,
   p_type varchar(25) not null,
   p_size integer not null,
   p_container char(10) not null,
   p_retailprice decimal(12,2) not null,
   p_comment varchar(23) not null,
   primary key (p_partkey)
);

create table supplier (
   s_suppkey integer not null,
   s_name char(25) not null,
   s_address varchar(40) not null,
   s_nationkey integer not null,
   s_phone char(15) not null,
   s_acctbal decimal(12,2) not null,
   s_comment varchar(101) not null,
   primary key (s_suppkey)
);

create table partsupp (
   ps_partkey integer not null,
   ps_suppkey integer not null,
   ps_availqty integer not null,
   ps_supplycost decimal(12,2) not null,
   ps_comment varchar(199) not null,
   primary key (ps_partkey,ps_suppkey)
);

create table customer (
   c_custkey integer not null,
   c_name varchar(25) not null,
   c_address varchar(40) not null,
   c_nationkey integer not null,
   c_phone char(15) not null,
   c_acctbal decimal(12,2) not null,
   c_mktsegment char(10) not null,
   c_comment varchar(117) not null,
   primary key (c_custkey)
);

create table orders (
   o_orderkey integer not null,
   o_custkey integer not null,
   o_orderstatus char(1) not null,
   o_totalprice decimal(12,2) not null,
   o_orderdate date not null,
   o_orderpriority char(15) not null,
   o_clerk char(15) not null,
   o_shippriority integer not null,
   o_comment varchar(79) not null,
   primary key (o_orderkey)
);

create table lineitem (
   l_orderkey integer not null,
   l_partkey integer not null,
   l_suppkey integer not null,
   l_linenumber integer not null,
   l_quantity decimal(12,2) not null,
   l_extendedprice decimal(12,2) not null,
   l_discount decimal(12,2) not null,
   l_tax decimal(12,2) not null,
   l_returnflag char(1) not null,
   l_linestatus char(1) not null,
   l_shipdate date not null,
   l_commitdate date not null,
   l_receiptdate date not null,
   l_shipinstruct char(25) not null,
   l_shipmode char(10) not null,
   l_comment varchar(44) not null,
   primary key (l_orderkey,l_linenumber)
);

create table nation (
   n_nationkey integer not null,
   n_name char(25) not null,
   n_regionkey integer not null,
   n_comment varchar(152) not null,
   primary key (n_nationkey)
);

create table region (
   r_regionkey integer not null,
   r_name char(25) not null,
   r_comment varchar(152) not null,
   primary key (r_regionkey)
);
)SQL";

TEST(CatalogTest, FlattenExampleSchema) {
    Catalog catalog;

    // Create script with TPCH schema
    Script script{catalog, 1};
    script.InsertTextAt(0, TPCH_SCHEMA);
    ASSERT_EQ(script.Scan(), buffers::status::StatusCode::OK);
    ASSERT_EQ(script.Parse(), buffers::status::StatusCode::OK);
    ASSERT_EQ(script.Analyze(), buffers::status::StatusCode::OK);
    auto& analyzed = script.GetAnalyzedScript();

    // Make sure the analyzed script matches expectations
    ASSERT_EQ(analyzed->GetDatabasesByName().size(), 1);
    ASSERT_EQ(analyzed->GetSchemasByName().size(), 1);
    ASSERT_EQ(analyzed->GetTablesByName().size(), 8);

    // Add to catalog
    auto catalog_status = catalog.LoadScript(script, 1);
    ASSERT_EQ(catalog_status, buffers::status::StatusCode::OK);

    // Flatten the catalog
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(catalog.Flatten(fb));
    auto flat = flatbuffers::GetRoot<buffers::catalog::FlatCatalog>(fb.GetBufferPointer());

    // Test the catalog
    ASSERT_EQ(flat->catalog_version(), catalog.GetVersion());
    ASSERT_EQ(flat->databases()->size(), 1);
    ASSERT_EQ(flat->schemas()->size(), 1);
}

}  // namespace
