// Copyright (c) 2020 The DashQL Authors

#include "dashql/extract/csv_parser.h"

#include <sstream>

#include "dashql/common/blob_stream.h"
#include "dashql/test/blob_stream_tests.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;
namespace sx = dashql::proto::syntax;

namespace {

void MatchIntegerChunk(duckdb::DataChunk& chunk, std::vector<std::vector<uint32_t>> values) {
    ASSERT_EQ(chunk.ColumnCount(), values.size());
    ASSERT_EQ(chunk.size(), values[0].size());
    for (unsigned col_id = 0; col_id < values.size(); ++col_id) {
        auto& col = values[col_id];
        for (unsigned row_id = 0; row_id < col.size(); ++row_id) {
            ASSERT_EQ(chunk.GetValue(col_id, row_id), col[row_id]) << "col=" << col_id << " row=" << row_id;
        }
    }
}

using LT = duckdb::LogicalType;

TEST(SimpleCSVParser, SimpleColumns) {
    auto blob_id = test::Blob::Register({R"CSV(1,2,3
4,5,6
7,8,9
)CSV"});
    BlobStreamBuffer blob_streambuf(test::Blob::StreamUnderflow, blob_id);
    std::istream blob_stream{&blob_streambuf};

    std::vector<duckdb::LogicalType> column_types{LT::INTEGER, LT::INTEGER, LT::INTEGER};
    duckdb::DataChunk output_chunk;
    output_chunk.Initialize(column_types);

    CSVParserOptions options;
    options.force_not_null = {false, false, false};
    options.sql_types = column_types;

    SimpleCSVParser parser{options, blob_stream};
    auto rc = parser.Parse(128, &output_chunk);

    ASSERT_TRUE(rc.IsOk()) << rc.err().message();
    MatchIntegerChunk(output_chunk, {
        {1, 4, 7},
        {2, 5, 8},
        {3, 6, 9},
    });
}

TEST(SimpleCSVParser, InvalidCSV) {
    auto test = [&](const char* csv) {
        auto blob_id = test::Blob::Register({csv});
        BlobStreamBuffer blob_streambuf(test::Blob::StreamUnderflow, blob_id);
        std::istream blob_stream{&blob_streambuf};

        std::vector<duckdb::LogicalType> column_types{LT::INTEGER, LT::INTEGER, LT::INTEGER};
        duckdb::DataChunk output_chunk;
        output_chunk.Initialize(column_types);

        CSVParserOptions options;
        options.force_not_null = {false, false, false};
        options.sql_types = column_types;

        SimpleCSVParser parser{options, blob_stream};
        auto rc = parser.Parse(128, &output_chunk);
        EXPECT_FALSE(rc.IsOk());
    };

    // Column mismatch
    test("1,2,3,X\n4,5,6\n7,8,9\n");
    test("1,2,3\n4,5,6,X\n7,8,9\n");
    test("1,2,3\n4,5,6\n7,8,9,X\n");
    test("1,2\n4,5,6\n7,8,9\n");
    test("1,2,3\n4,5\n7,8,9\n");
    test("1,2,3\n4,5,6\n7,8\n");

    // Unterminated quotes
    test("\"1,2,3\n4,5,6\n7,8,9\n");
    test("1,2,\"3\n4,5,6\n7,8,9\n");
    test("1,2,3\"\n4,5,6\n7,8,9\n");
    test("1,2,3\n\"4,5,6\n7,8,9\n");
    test("1,2,3\n4\",5,6\n7,8,9\n");
    test("1,2,3\n4,5,6\n7,8,9\n\"");

    // Invalid Escapes
    test("\\1,2,3\n4,5,6\n7,8,9\n");
    test("1\\,2,3\n4,5,6\n7,8,9\n");
    test("1,2,\\3\n4,5,6\n7,8,9\n");
    test("1,2,3\\\n4,5,6\n7,8,9\n\\");
}

}  // namespace
