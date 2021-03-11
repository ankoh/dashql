// Copyright (c) 2020 The DashQL Authors

#include "dashql/common/blob_stream.h"
#include "dashql/common/ffi_response.h"
#include "dashql/extract/extract.h"
#include "dashql/proto_generated.h"
#include "dashql/webdb/webdb.h"

using namespace dashql;
using namespace dashql::webdb;

extern "C" {

using ConnectionHdl = uintptr_t;

/// Import CSV from a given blob
void dashql_extract_import_csv(FFIResponse* packed, ConnectionHdl connHdl, BlobID blobId, const char* schemaName, const char* tableName) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);

    duckdb::BufferedCSVReaderOptions opts;
    // Use the sniffer to detect the columns instead of manually specifying them in the ExtractCSV call below
    opts.auto_detect = true;

    BlobStreamBuffer blob_streambuf(dashql_blob_stream_underflow, blobId);
    auto r = ExtractCSV(*c, blob_streambuf, opts, {}, std::string(schemaName),std::string(schemaName));
    FFIResponseBuffer::GetInstance().Store(*packed, std::move(r));
}
}