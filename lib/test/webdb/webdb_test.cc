// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/webdb.h"

#include <sstream>

#include "dashql/proto_generated.h"
#include "dashql/test/config.h"
#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/timestamp.hpp"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/web/filesystem.h"
#include "gtest/gtest.h"
#include "parquet-extension.hpp"

using namespace duckdb::web;
using namespace std;

namespace {

TEST(WebDB, InvalidSQL) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        INVALID SQL
    )RAW");
    ASSERT_TRUE(expected.IsErr());
}

TEST(WebDB, LoadCSV) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
    auto data = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "test.csv";
    auto expected = conn.ImportCSV(data.string(), "test_schema", "test_table");
    ASSERT_TRUE(expected.IsOk());
}

TEST(WebDB, LoadJSONRowMajor) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
    auto expected = conn.ImportJSON(R"([
            {"MatrNr":26120,"Titel":"Grundzüge"},
            {"MatrNr":27550,"Titel":"Grundzüge"},
            {"MatrNr":27550,"Titel":"Logik"},
            {"MatrNr":28106,"Titel":"Ethik"},
            {"MatrNr":28106,"Titel":"Wissenschaftstheorie"},
            {"MatrNr":28106,"Titel":"Bioethik"},
            {"MatrNr":28106,"Titel":"Der Wieer Kreis"},
            {"MatrNr":29120,"Titel":"Grundzüge"},
            {"MatrNr":29120,"Titel":"Ethik"},
            {"MatrNr":29120,"Titel":"Mäeutik"},
            {"MatrNr":29555,"Titel":"Glaube und Wissen"},
            {"MatrNr":25403,"Titel":"Glaube und Wissen"}])",
                                    "json_schema", "test_table5");
    ASSERT_TRUE(expected.IsOk());
}

TEST(WebDB, LoadJSONRowMajorInconsistent) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
    auto expected = conn.ImportJSON(R"([
            {"MatrNr":26120,"Titel":"Grundzüge"},
            {"MatrNr":27550,"Titel":"Grundzüge"},
            {"MatrNr":27550,"Titel":"Logik"},
            {"MatrNr":28106},
            {"MatrNr":28106,"Titel":"Wissenschaftstheorie"},
            {"MatrNr":28106,"Titel":"Bioethik"},
            {"MatrNr":28106,"Titel":"Der Wieer Kreis"},
            {"MatrNr":29120,"Titel":"Grundzüge"},
            {"MatrNr":29120,"Titel":"Ethik"},
            {"MatrNr":29120,"Titel":"Mäeutik"},
            {"MatrNr":29555,"Titel":"Glaube und Wissen"},
            {"MatrNr":25403,"Titel":"Glaube und Wissen"}])",
                                    "json_schema", "test_table6");
    ASSERT_TRUE(expected.IsErr());
}

TEST(WebDB, LoadJSONColumnMajor) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
    auto expected = conn.ImportJSON(R"({
        "PersNr": [2125, 2126, 2127, 2133, 2134, 2136, 2137],
        "Name": ["Sokrates", "Russel", "Kopernikus", "Popper", "Augustinus", "Curie", "Kant"]
    })",
                                    "json_schema", "test_table7");
    ASSERT_TRUE(expected.IsOk());
}

TEST(WebDB, LoadJSONColumnMajorInconsistent) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
    auto expected = conn.ImportJSON(R"({
        "PersNr": [2125, 2126, 2127, 2133, 2134, 2136, 2137],
        "Name": ["Sokrates", "Russel", "Popper", "Augustinus", "Curie", "Kant"]
    })",
                                    "json_schema", "test_table8");
    ASSERT_TRUE(expected.IsErr());
}

TEST(WebDB, LoadParquet) {
    auto db = make_shared<duckdb::DuckDB>();
    db->LoadExtension<duckdb::ParquetExtension>();
    auto con = duckdb::Connection{*db};
    std::stringstream ss;
    auto data = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "studenten.parquet";
    ss << "SELECT * FROM parquet_scan('" << data.string() << "');";
    auto result = con.Query(ss.str());
    ASSERT_STREQ(result->ToString().c_str(),
                 "MatrNr\tName\tSemester\t\nINTEGER\tVARCHAR\tINTEGER\t\n"
                 "[ Rows: 8]\n"
                 "24002\tXenokrates\t18\t\n"
                 "25403\tJonas\t12\t\n"
                 "26120\tFichte\t10\t\n"
                 "26830\tAristoxenos\t8\t\n"
                 "27550\tSchopenhauer\t6\t\n"
                 "28106\tCarnap\t3\t\n"
                 "29120\tTheophrastos\t2\t\n"
                 "29555\tFeuerbach\t2\t\n\n");
}

TEST(WebDB, LoadCSVIStream) {
    using LT = duckdb::LogicalType;

    auto db = make_shared<duckdb::DuckDB>();
    auto data = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "test.csv";
    duckdb::BufferedCSVReaderOptions options;
    options.auto_detect = true;
    std::vector<duckdb::LogicalType> column_types{LT::INTEGER, LT::INTEGER, LT::INTEGER};
    duckdb::DataChunk output_chunk;
    output_chunk.Initialize(column_types);
    auto str = data.string();
    auto fh = db->GetFileSystem().OpenFile(str, duckdb::FileFlags::FILE_FLAGS_READ);
    duckdb::web::FileSystemStreamBuffer streambuf(db->GetFileSystem(), *fh);

    try {
        duckdb::BufferedCSVReader reader(options, column_types, std::make_unique<std::istream>(&streambuf));
        reader.ParseCSV(output_chunk);
        ASSERT_STREQ(output_chunk.ToString().c_str(),
                     "Chunk - [3 Columns]\n"
                     "- FLAT INTEGER: 3 = [ 1, 4, 7]\n"
                     "- FLAT INTEGER: 3 = [ 2, 5, 8]\n"
                     "- FLAT INTEGER: 3 = [ 3, 6, 9]\n");
    } catch (std::exception const& e) {
        FAIL() << e.what();
    }
}

}  // namespace
