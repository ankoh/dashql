// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/csv_reader.h"

#include "duckdb/catalog/catalog.hpp"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/main/client_context.hpp"
#include "duckdb/parser/parsed_data/create_schema_info.hpp"
#include "duckdb/parser/parsed_data/create_table_info.hpp"
#include "duckdb/planner/binder.hpp"
#include "duckdb/planner/parsed_data/bound_create_table_info.hpp"

namespace duckdb {
namespace web {

/// Constructor
CSVReader::CSVReader(duckdb::Connection& connection, std::unique_ptr<std::istream> in, CSVReaderArgs args)
    : connection_(connection),
      reader_(std::move(args.options), {}, std::move(in)),
      schema_(std::move(args.schema)),
      table_(args.table) {}

/// Initialize the reader
arrow::Status CSVReader::Initialize() {
    auto& ctx = *connection_.context;
    auto& catalog = duckdb::Catalog::GetCatalog(ctx);

    // Create the schema if it exists
    duckdb::SchemaCatalogEntry* schema = nullptr;
    try {
        schema = catalog.GetSchema(ctx, schema_);
    } catch (duckdb::CatalogException const& e) {
        auto info = std::make_unique<duckdb::CreateSchemaInfo>();
        info->schema = schema_;
        schema = (duckdb::SchemaCatalogEntry*)catalog.CreateSchema(ctx, info.get());
    }

    // Create a table
    try {
        auto info = std::make_unique<duckdb::CreateTableInfo>(schema_, table_);
        {
            std::vector<duckdb::ColumnDefinition> columns;
            for (idx_t i = 0; i < reader_.sql_types.size(); i++) {
                columns.emplace_back(reader_.col_names[i], reader_.sql_types[i]);
            }
            info->columns = std::move(columns);
        }

        auto binder = duckdb::Binder::CreateBinder(ctx);
        auto bound_info = binder->BindCreateTableInfo(move(info));
        catalog.CreateTable(ctx, bound_info.get());
    } catch (const std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, move(e.what())};
    }
    return arrow::Status::OK();
}

/// Read from CSV until the input is depleted
arrow::Result<size_t> CSVReader::ParseEntireInput() {
    auto total_rows = 0;
    try {
        // Initialize the data chunk
        duckdb::DataChunk out;
        out.Initialize(reader_.sql_types);

        // Resolve the table info
        auto table = connection_.context->TableInfo(schema_, table_);

        // Parse entire file and append data chunks to table
        do {
            reader_.ParseCSV(out);
            total_rows += out.size();
            connection_.context->Append(*table, out);
            out.Reset();
        } while (out.size() > 0);

    } catch (const std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, move(e.what())};
    }

    return total_rows;
}

/// Read the csv reader arguments from a json document
arrow::Result<CSVReaderArgs> CSVReader::ReadArgumentsFromJSON(std::string_view input) {
    CSVReaderArgs args;
    // XXX actually parse the arguments
    args.schema = "main";
    args.table = "foo";
    args.options = {};
    args.options.auto_detect = true;
    return args;
}

}  // namespace web
}  // namespace duckdb
