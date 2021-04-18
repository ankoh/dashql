// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/webdb.h"

#include <cstdio>
#include <memory>
#include <optional>
#include <string_view>
#include <unordered_map>

#include "arrow/buffer.h"
#include "arrow/c/bridge.h"
#include "arrow/csv/api.h"
#include "arrow/io/memory.h"
#include "arrow/ipc/options.h"
#include "arrow/ipc/writer.h"
#include "arrow/json/api.h"
#include "arrow/result.h"
#include "arrow/status.h"
#include "arrow/table.h"
#include "arrow/type_fwd.h"
#include "dashql/common/defer.h"
#include "duckdb.hpp"
#include "duckdb/common/arrow.hpp"
#include "duckdb/common/file_system.hpp"
#include "duckdb/common/types/data_chunk.hpp"
#include "duckdb/main/query_result.hpp"
#include "duckdb/web/io/arrow_ifstream.h"
#include "duckdb/web/io/buffered_filesystem.h"
#include "duckdb/web/io/default_filesystem.h"
#include "duckdb/web/io/web_filesystem.h"
#include "parquet-extension.hpp"
#include "rapidjson/document.h"
#include "rapidjson/error/en.h"
#include "rapidjson/reader.h"

namespace duckdb {
namespace web {

/// Get the static webdb instance
WebDB& WebDB::GetInstance() {
    static std::unique_ptr<WebDB> db = std::make_unique<WebDB>();
    return *db;
}

/// Constructor
WebDB::Connection::Connection(WebDB& webdb) : webdb_(webdb), connection_(*webdb.database_), current_query_result_() {}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::RunQuery(std::string_view text) {
    try {
        // Send the query
        auto result = connection_.SendQuery(std::string{text});
        if (!result->success) return arrow::Status{arrow::StatusCode::ExecutionError, move(result->error)};
        current_query_result_.reset();
        current_schema_.reset();

        // Configure the output writer
        ArrowSchema raw_schema;
        result->ToArrowSchema(&raw_schema);
        ARROW_ASSIGN_OR_RAISE(auto schema, arrow::ImportSchema(&raw_schema));
        ARROW_ASSIGN_OR_RAISE(auto out, arrow::io::BufferOutputStream::Create());
        ARROW_ASSIGN_OR_RAISE(auto writer, arrow::ipc::MakeFileWriter(out, schema));

        // Write chunk stream
        for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {
            // Import the data chunk as record batch
            ArrowArray array;
            chunk->ToArrowArray(&array);
            // Write record batch to the output stream
            ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, schema));
            ARROW_RETURN_NOT_OK(writer->WriteRecordBatch(*batch));
        }
        ARROW_RETURN_NOT_OK(writer->Close());
        return out->Finish();
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::SendQuery(std::string_view text) {
    try {
        // Send the query
        auto result = connection_.SendQuery(std::string{text});
        if (!result->success) return arrow::Status{arrow::StatusCode::ExecutionError, move(result->error)};
        current_query_result_ = move(result);
        current_schema_.reset();

        // Import the schema
        ArrowSchema raw_schema;
        current_query_result_->ToArrowSchema(&raw_schema);

        ARROW_ASSIGN_OR_RAISE(current_schema_, arrow::ImportSchema(&raw_schema));

        // Serialize the schema
        return arrow::ipc::SerializeSchema(*current_schema_);
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::FetchQueryResults() {
    try {
        // Fetch data if a query is active
        std::unique_ptr<duckdb::DataChunk> chunk;
        if (current_query_result_ == nullptr) {
            return nullptr;
        }

        // Fetch next result chunk
        chunk = current_query_result_->Fetch();
        if (!current_query_result_->success) {
            return arrow::Status{arrow::StatusCode::ExecutionError, move(current_query_result_->error)};
        }

        // Reached end?
        if (!chunk) {
            current_query_result_.reset();
            current_schema_.reset();
            return nullptr;
        }

        // Serialize the record batch
        ArrowArray array;
        chunk->ToArrowArray(&array);
        ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, current_schema_));
        return arrow::ipc::SerializeRecordBatch(*batch, arrow::ipc::IpcWriteOptions::Defaults());
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

#define SET_OPTION(source, target, member, type)                                                                      \
    if (source.HasMember(#member)) {                                                                                  \
        if (!source[#member].Is##type()) return arrow::Status::Invalid(#source "." #member " expected to be " #type); \
        target.member = source[#member].Get##type();                                                                  \
    }

#define SET_OPTION_CHAR(source, target, member)                                                                       \
    if (source.HasMember(#member)) {                                                                                  \
        if (!source[#member].IsString()) return arrow::Status::Invalid(#source "." #member " expected to be String"); \
        target.member = source[#member].GetString()[0];                                                               \
    }

#define SET_OPTION_ARRAY(source, target, member, value_type)                                                        \
    if (source.HasMember(#member)) {                                                                                \
        if (!source[#member].IsArray()) return arrow::Status::Invalid(#source "." #member " expected to be array"); \
        for (auto const& val : source[#member].GetArray()) {                                                        \
            if (!val.Is##value_type()) {                                                                            \
                return arrow::Status::Invalid(#source "." #member " values expected to be " #value_type);           \
            }                                                                                                       \
            target.member.push_back(val.Get##value_type());                                                         \
        }                                                                                                           \
    }

arrow::Status WebDB::Connection::ImportCSV(std::string_view path, std::string_view options) {
    rapidjson::Document document;
    rapidjson::ParseResult ok = document.Parse(options.data());
    if (!ok) {
        return arrow::Status::Invalid(rapidjson::GetParseError_En(ok.Code()));
    }

    auto input = std::make_shared<io::InputFileStream>(webdb_.buffer_manager_, path.data());

    auto io_context = arrow::io::default_io_context();
    auto read_options = arrow::csv::ReadOptions::Defaults();
    read_options.use_threads = false;
    auto parse_options = arrow::csv::ParseOptions::Defaults();
    auto convert_options = arrow::csv::ConvertOptions::Defaults();
    if (document.HasMember("read")) {
        auto const& obj = document["read"];
        if (!obj.IsObject()) return arrow::Status::Invalid("read expected to be Object");
        SET_OPTION(obj, read_options, block_size, Int);
        SET_OPTION(obj, read_options, skip_rows, Int);
        SET_OPTION(obj, read_options, autogenerate_column_names, Bool);
        SET_OPTION_ARRAY(obj, read_options, column_names, String);
    }
    if (document.HasMember("parse")) {
        auto const& obj = document["parse"];
        if (!obj.IsObject()) return arrow::Status::Invalid("parse expected to be Object");
        SET_OPTION(obj, parse_options, quoting, Bool);
        SET_OPTION(obj, parse_options, double_quote, Bool);
        SET_OPTION(obj, parse_options, escaping, Bool);
        SET_OPTION(obj, parse_options, newlines_in_values, Bool);
        SET_OPTION(obj, parse_options, ignore_empty_lines, Bool);
        SET_OPTION_CHAR(obj, parse_options, delimiter);
        SET_OPTION_CHAR(obj, parse_options, quote_char);
        SET_OPTION_CHAR(obj, parse_options, escape_char);
    }
    if (document.HasMember("convert")) {
        auto const& obj = document["convert"];
        if (!obj.IsObject()) return arrow::Status::Invalid("convert expected to be Object");
        SET_OPTION(obj, convert_options, check_utf8, Bool);
        SET_OPTION(obj, convert_options, strings_can_be_null, Bool);
        SET_OPTION(obj, convert_options, auto_dict_encode, Bool);
        SET_OPTION(obj, convert_options, auto_dict_max_cardinality, Int);
        SET_OPTION(obj, convert_options, include_missing_columns, Bool);
        SET_OPTION_ARRAY(obj, convert_options, null_values, String);
        SET_OPTION_ARRAY(obj, convert_options, true_values, String);
        SET_OPTION_ARRAY(obj, convert_options, false_values, String);
        SET_OPTION_ARRAY(obj, convert_options, include_columns, String);
    }

    std::string schema_name = DEFAULT_SCHEMA;
    std::string table_name;

    if (document.HasMember("import")) {
        auto const& obj = document["import"];
        if (!obj.IsObject()) return arrow::Status::Invalid("import expected to be Object");
        if (obj.HasMember("schema")) {
            if (!obj["schema"].IsString()) return arrow::Status::Invalid("import.schema expected to be String");
            schema_name = obj["schema"].GetString();
        }
        if (!obj.HasMember("table")) {
            return arrow::Status::Invalid("Required member import.table not present");
        }
        if (!obj["table"].IsString()) return arrow::Status::Invalid("import.table expected to be String");
        table_name = obj["table"].GetString();
    } else {
        return arrow::Status::Invalid("Required member \"import\" not present");
    }

    try {
        auto res_reader =
            arrow::csv::StreamingReader::Make(io_context, input, read_options, parse_options, convert_options);
        if (!res_reader.ok()) {
            return res_reader.status();
        }
        auto reader = res_reader.ValueUnsafe();
        ArrowArrayStream stream;
        auto status = arrow::ExportRecordBatchReader(reader, &stream);
        if (!status.ok()) {
            return status;
        }

        auto create_status = RunQuery("CREATE SCHEMA IF NOT EXISTS " + schema_name);
        if (!create_status.ok()) {
            return create_status.status();
        }
        connection_.TableFunction("arrow_scan", {duckdb::Value::POINTER((uintptr_t)&stream)})
            ->Create(schema_name, table_name);

        return arrow::Status::OK();
    } catch (std::exception const& e) {
        return arrow::Status::UnknownError(e.what());
    }
}

arrow::Status WebDB::Connection::ImportJSON(std::string_view path, std::string_view options) {
    return arrow::Status::OK();
}

/// Constructor
WebDB::WebDB()
    : buffer_manager_(std::make_shared<io::BufferManager>(io::CreateDefaultFileSystem())),
      database_(),
      connections_(),
      db_config_() {
    auto buffered_filesystem = std::make_unique<io::BufferedFileSystem>(buffer_manager_);
    db_config_.file_system = std::move(std::move(buffered_filesystem));
    database_ = std::make_shared<duckdb::DuckDB>(nullptr, &db_config_);
    database_->LoadExtension<duckdb::ParquetExtension>();
    zip_ = std::make_unique<Zipper>(buffer_manager_);
}

/// Create a session
WebDB::Connection* WebDB::Connect() {
    auto conn = std::make_unique<WebDB::Connection>(*this);
    auto conn_ptr = conn.get();
    connections_.insert({conn_ptr, move(conn)});
    return conn_ptr;
}

/// End a session
void WebDB::Disconnect(Connection* session) { connections_.erase(session); }
/// Flush all file buffers
void WebDB::FlushFiles() { buffer_manager_->Flush(); }
/// Flush file by path
void WebDB::FlushFile(std::string_view path) { buffer_manager_->FlushFile(path); }

}  // namespace web
}  // namespace duckdb
