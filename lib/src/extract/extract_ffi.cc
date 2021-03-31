// Copyright (c) 2020 The DashQL Authors

#include <iostream>
#include <sstream>

#include "dashql/common/blob_stream.h"
#include "dashql/common/expected.h"
#include "dashql/common/ffi_response.h"
#include "dashql/extract/csv_parser.h"
#include "dashql/extract/csv_sniffer.h"
#include "dashql/extract/extract.h"
#include "dashql/proto_generated.h"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/web/filesystem.h"

using namespace dashql;
using namespace duckdb::web;

extern "C" {

using ConnectionHdl = uintptr_t;
using LT = duckdb::LogicalType;

/// Import CSV from a given blob
void dashql_extract_import_csv(FFIResponse* packed, ConnectionHdl connHdl, const char* filePath, const char* schemaName,
                               const char* tableName) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);

    std::vector<duckdb::LogicalType> column_types{LT::INTEGER, LT::INTEGER, LT::INTEGER};
    duckdb::DataChunk output_chunk;
    output_chunk.Initialize(column_types);

    duckdb::BufferedCSVReaderOptions options;
    options.num_cols = 3;
    auto& fs = WebDB::GetInstance().GetFileSystem();
    auto handle = fs.OpenFile(filePath, duckdb::FileFlags::FILE_FLAGS_READ);
    duckdb::web::FileSystemStreamBuffer streambuf(fs, *handle);
    try {
        duckdb::BufferedCSVReader reader(options, column_types, std::make_unique<std::istream>(&streambuf));
        reader.ParseCSV(output_chunk);
        FFIResponseBuffer::GetInstance().Store(*packed, Signal::OK());
    } catch (const std::exception& e) {
        FFIResponseBuffer::GetInstance().Store(*packed, Error(ErrorCode::CSV_PARSER_ERROR) << e.what());
    }
}
}
