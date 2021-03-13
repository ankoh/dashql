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
#include "dashql/webdb/webdb.h"

using namespace dashql;
using namespace dashql::webdb;

extern "C" {

using ConnectionHdl = uintptr_t;
using LT = duckdb::LogicalType;

/// Import CSV from a given blob
void dashql_extract_import_csv(FFIResponse* packed, ConnectionHdl connHdl, BlobID blobId, const char* schemaName,
                               const char* tableName) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);

    std::vector<duckdb::LogicalType> column_types{LT::INTEGER, LT::INTEGER, LT::INTEGER};
    duckdb::DataChunk output_chunk;
    output_chunk.Initialize(column_types);

    CSVParserOptions options;
    options.force_not_null = {false, false, false};
    options.sql_types = column_types;
    BlobStreamBuffer blob_streambuf(dashql_blob_stream_underflow, blobId);
    std::istream blob_stream{&blob_streambuf};
    SimpleCSVParser parser{options, blob_stream};
    auto rc = parser.Parse(128, &output_chunk);
    FFIResponseBuffer::GetInstance().Store(*packed, std::move(rc));
}
}