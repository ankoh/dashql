#include "duckdb/arrowapi/database.h"

#include "arrow/buffer.h"
#include "arrow/io/memory.h"
#include "arrow/ipc/reader.h"
#include "arrow/ipc/type_fwd.h"
#include "arrow/ipc/writer.h"
#include "arrow/record_batch.h"
#include "arrow/result.h"
#include "arrow/status.h"
#include "arrow/type_fwd.h"
#include "duckdb/arrowapi/bridge.h"

namespace duckdb {
namespace arrowapi {

arrow::Result<std::shared_ptr<arrow::Buffer>> Database::Connection::MaterializeQueryResult(
    std::unique_ptr<duckdb::QueryResult> result) {
    current_query_result_.reset();
    current_schema_.reset();

    // Configure the output writer
    ArrowSchema raw_schema;
    auto timezone = QueryResult::GetConfigTimezone(*result);
    result->ToArrowSchema(&raw_schema, result->types, result->names, timezone);
    ARROW_ASSIGN_OR_RAISE(auto schema, arrow::ImportSchema(&raw_schema));

    // Create the file writer
    ARROW_ASSIGN_OR_RAISE(auto out, arrow::io::BufferOutputStream::Create());
    ARROW_ASSIGN_OR_RAISE(auto writer, arrow::ipc::MakeFileWriter(out, schema));

    // Write chunk stream
    for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {
        // Import the data chunk as record batch
        ArrowArray array;
        chunk->ToArrowArray(&array);
        // Import the record batch
        ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, schema));
        // Write the record batch
        ARROW_RETURN_NOT_OK(writer->WriteRecordBatch(*batch));
    }
    ARROW_RETURN_NOT_OK(writer->Close());
    return out->Finish();
}

arrow::Result<std::shared_ptr<arrow::Buffer>> Database::Connection::StreamQueryResult(
    std::unique_ptr<duckdb::QueryResult> result) {
    current_query_result_ = std::move(result);
    current_schema_.reset();

    // Import the schema
    ArrowSchema raw_schema;
    auto timezone = QueryResult::GetConfigTimezone(*current_query_result_);
    current_query_result_->ToArrowSchema(&raw_schema, current_query_result_->types, current_query_result_->names,
                                         timezone);
    ARROW_ASSIGN_OR_RAISE(current_schema_, arrow::ImportSchema(&raw_schema));

    // Serialize the schema
    return arrow::ipc::SerializeSchema(*current_schema_);
}

arrow::Result<std::shared_ptr<arrow::Buffer>> Database::Connection::RunQuery(std::string_view text) {
    try {
        // Send the query
        auto result = connection_.SendQuery(std::string{text});
        if (!result->success) {
            return arrow::Status{arrow::StatusCode::ExecutionError, std::move(result->error)};
        }
        return MaterializeQueryResult(std::move(result));
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    } catch (...) {
        return arrow::Status{arrow::StatusCode::ExecutionError, "unknown exception"};
    }
}

arrow::Result<std::shared_ptr<arrow::Buffer>> Database::Connection::SendQuery(std::string_view text) {
    try {
        // Send the query
        auto result = connection_.SendQuery(std::string{text});
        if (!result->success) return arrow::Status{arrow::StatusCode::ExecutionError, std::move(result->error)};
        return StreamQueryResult(std::move(result));
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    } catch (...) {
        return arrow::Status{arrow::StatusCode::ExecutionError, "unknown exception"};
    }
}

arrow::Result<std::shared_ptr<arrow::Buffer>> Database::Connection::FetchQueryResults() {
    try {
        // Fetch data if a query is active
        std::unique_ptr<duckdb::DataChunk> chunk;
        if (current_query_result_ == nullptr) {
            return nullptr;
        }
        // Fetch next result chunk
        chunk = current_query_result_->Fetch();
        if (!current_query_result_->success) {
            return arrow::Status{arrow::StatusCode::ExecutionError, std::move(current_query_result_->error)};
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
        // Serialize the record batch
        auto options = arrow::ipc::IpcWriteOptions::Defaults();
        options.use_threads = false;
        return arrow::ipc::SerializeRecordBatch(*batch, options);
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

}  // namespace arrowapi
}  // namespace duckdb
