// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/webdb.h"

#include <arrow/ipc/options.h>

#include <cstdio>
#include <duckdb/common/file_system.hpp>
#include <duckdb/common/types/data_chunk.hpp>
#include <memory>
#include <optional>
#include <string_view>
#include <unordered_map>

#include "arrow/buffer.h"
#include "arrow/c/bridge.h"
#include "arrow/csv/api.h"
#include "arrow/io/memory.h"
#include "arrow/ipc/writer.h"
#include "arrow/json/api.h"
#include "arrow/result.h"
#include "arrow/status.h"
#include "arrow/type_fwd.h"
#include "dashql/common/defer.h"
#include "duckdb.hpp"
#include "duckdb/common/arrow.hpp"
#include "duckdb/main/query_result.hpp"
#include "duckdb/web/io/arrow_ifstream.h"
#include "duckdb/web/io/buffered_filesystem.h"
#include "duckdb/web/io/default_filesystem.h"
#include "duckdb/web/io/web_filesystem.h"
#include "parquet-extension.hpp"
#include "rapidjson/document.h"
#include "rapidjson/error/en.h"
#include "rapidjson/reader.h"
#include "rapidjson/schema.h"

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

const char* csv_options_schema = R"({
    "type": "object",
    "properties": {
        "read": {
            "type": "object",
            "properties": {
                "block_size": {
                    "type": "integer"
                },
                "skip_rows": {
                    "type": "integer"
                },
                "column_names": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    }
                },
                "autogenerate_column_names": {
                    "type": "boolean"
                }
            }
        },
        "parse": {
            "type": "object",
            "properties": {
                "delimiter": {
                    "type": "string"
                },
                "quoting": {
                    "type": "boolean"
                },
                "quote_char": {
                    "type": "string"
                },
                "double_quote": {
                    "type": "boolean"
                },
                "escaping": {
                    "type": "boolean"
                },
                "escape_char": {
                    "type": "string"
                },
                "newlines_in_values": {
                    "type": "boolean"
                },
                "ignore_empty_lines": {
                    "type": "boolean"
                }
            }
        },
        "convert": {
            "type": "object",
            "properties": {
                "check_utf8": {
                    "type": "boolean"
                },
                "strings_can_be_null": {
                    "type": "boolean"
                },
                "null_values": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    }
                },
                "true_values": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    }
                },
                "false_values": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    }
                },
                "auto_dict_encode": {
                    "type": "boolean"
                },
                "auto_dict_max_cardinality": {
                    "type": "integer"
                },
                "include_columns": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    }
                },
                "include_missing_columns": {
                    "type": "boolean"
                }
            }
        },
        "import": {
            "type": "object",
            "properties": {
                "schema": {
                    "type": "string"
                },
                "table": {
                    "type": "string"
                }
            },
            "required": [
                "table"
            ]
        }
    },
    "required": [
        "import"
    ]
})";

arrow::Status WebDB::Connection::ImportCSV(std::string_view path, std::string_view options) {
    static rapidjson::Document schema;
    if (schema.IsEmpty()) {
        rapidjson::ParseResult ok = schema.Parse(csv_options_schema);
        if (!ok) {
            return arrow::Status::Invalid(rapidjson::GetParseError_En(ok.Code()));
        }
    }

    rapidjson::Document document;
    rapidjson::ParseResult ok = document.Parse(options.data());
    if (!ok) {
        return arrow::Status::Invalid(rapidjson::GetParseError_En(ok.Code()));
    }

    rapidjson::SchemaValidator validator(schema);
    if (!document.Accept(validator)) {
    }

    auto input = std::make_shared<io::InputFileStream>(webdb_.buffer_manager_, path.data());

    auto io_context = arrow::io::default_io_context();
    auto read_options = arrow::csv::ReadOptions::Defaults();
    read_options.use_threads = false;
    if (document.HasMember("read")) {
        auto const& read = document["read"];
        if (read.HasMember("block_size")) {
            if (!read["block_size"].IsInt()) {
                return arrow::Status::Invalid("read.block_size expected to be integer");
            }
            read_options.block_size = read["block_size"].GetInt();
        }
        if (read.HasMember("skip_rows")) {
            if (!read["skip_rows"].IsInt()) {
                return arrow::Status::Invalid("read.skip_rows expected to be integer");
            }
            read_options.skip_rows = read["skip_rows"].GetInt();
        }
        if (read.HasMember("column_names")) {
            if (!read["column_names"].IsArray()) {
                return arrow::Status::Invalid("read.column_names expected to be array");
            }
            for (auto const& val : read["column_names"].GetArray()) {
                if (!val.IsString()) {
                    return arrow::Status::Invalid("read.column_names values expected to be strings");
                }
                read_options.column_names.push_back(val.GetString());
            }
        }
        if (read.HasMember("autogenerate_column_names")) {
            if (!read["autogenerate_column_names"].IsBool()) {
                return arrow::Status::Invalid("read.autogenerate_column_names expected to be boolean");
            }
            read_options.autogenerate_column_names = read["autogenerate_column_names"].GetBool();
        }
    }
    auto parse_options = arrow::csv::ParseOptions::Defaults();
    auto convert_options = arrow::csv::ConvertOptions::Defaults();

    auto res_reader = arrow::csv::TableReader::Make(io_context, input, read_options, parse_options, convert_options);
    if (!res_reader.ok()) {
        return res_reader.status();
    }
    auto reader = res_reader.ValueUnsafe();

    auto maybe_table = reader->Read();
    if (!maybe_table.ok()) {
        return maybe_table.status();
    }
    auto table = maybe_table.ValueUnsafe();

    // import now
    return arrow::Status::OK();
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
