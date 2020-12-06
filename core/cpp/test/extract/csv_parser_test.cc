// Copyright (c) 2020 The DashQL Authors

#include "dashql/common/blob_stream.h"
#include "dashql/extract/csv_parser.h"
#include "dashql/test/blob_stream_tests.h"

#include <sstream>

#include "gtest/gtest.h"

using namespace std;
using namespace dashql;
namespace sx = dashql::proto::syntax;

namespace {

TEST(SimpleCSVParser, CSVExtractAutoDetect) {
//    auto blob_id = test::Blob::Register({R"CSV(a,b,c
//1,2,3
//4,5,6
//7,8,9)CSV"});
//    BlobIStreamBuffer blob_streambuf(test::Blob::StreamUnderflow, blob_id);
//    std::istream blob_stream{&blob_streambuf};
//
//    std::vector<duckdb::LogicalType> output_types{
//        duckdb::LogicalType::INTEGER,
//        duckdb::LogicalType::INTEGER,
//        duckdb::LogicalType::INTEGER,
//    };
//    duckdb::DataChunk output_chunk;
//    output_chunk.Initialize(output_types);
//
//    CSVParserOptions options;
//    options.header = true;
//
//    SimpleCSVParser parser{options, blob_stream};
//    parser.Parse(&output_chunk, 1024);
}

}  // namespace
