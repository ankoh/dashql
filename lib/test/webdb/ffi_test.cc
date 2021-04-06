// Copyright (c) 2020 The DashQL Authors

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>

#include "dashql/proto_generated.h"
#include "dashql/test/config.h"
#include "duckdb/web/webdb.h"
#include "duckdb/web/webdb_ffi.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"

using namespace duckdb::web;

namespace {

std::string tmpfile(const char* data) {
    char file[] = "/tmp/ffiXXXXXX";
    mkstemp(file);
    std::ofstream of(file);
    of << data;
    of.close();
    return std::string(file);
}

TEST(FFI, InvalidSQL) {
    auto conn = duckdb_web_connect();
    dashql::FFIResponse response;
    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(proto::CreateQueryArgumentsDirect(builder, "INVALID SQL", {}));
    duckdb_web_run_query(&response, conn, builder.GetBufferPointer());
    duckdb_web_disconnect(conn);
    ASSERT_NE(response.statusCode, 0);
}

TEST(FFI, ImportCSV) {
    auto conn = duckdb_web_connect();
    dashql::FFIResponse response;
    duckdb_web_import_csv(&response, conn, tmpfile("1,2,3\n4,5,4\n7,8,9").c_str(), "test_schema", "test_table");
    duckdb_web_disconnect(conn);
    ASSERT_EQ(response.statusCode, 0);
}

TEST(FFI, ImportParquet) {
    auto conn = duckdb_web_connect();
    {
        dashql::FFIResponse response;
        flatbuffers::FlatBufferBuilder builder;
        builder.Finish(proto::CreateQueryArgumentsDirect(builder, "CREATE SCHEMA IF NOT EXISTS test_schema", {}));
        duckdb_web_run_query(&response, conn, builder.GetBufferPointer());
        ASSERT_EQ(response.statusCode, 0);
    }
    {
        dashql::FFIResponse response;
        flatbuffers::FlatBufferBuilder builder;
        auto data = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "studenten.parquet";
        builder.Finish(proto::CreateQueryArgumentsDirect(
            builder,
            (std::string("CREATE TABLE test_schema.parquet_table AS SELECT * FROM parquet_scan('") + data.string() +
             std::string("')"))
                .c_str(),
            {}));
        duckdb_web_run_query(&response, conn, builder.GetBufferPointer());
        ASSERT_EQ(response.statusCode, 0);
    }
    duckdb_web_disconnect(conn);
}

TEST(FFI, ImportJSON) {
    auto conn = duckdb_web_connect();
    dashql::FFIResponse response;
    duckdb_web_import_json(&response, conn,
                           R"([
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
                           "test_schema", "test_table2");
    duckdb_web_disconnect(conn);
    ASSERT_EQ(response.statusCode, 0);
}

TEST(FFI, ImportJSONNulls) {
    auto conn = duckdb_web_connect();
    dashql::FFIResponse response;
    duckdb_web_import_json(&response, conn,
                           R"([
                               {"MatrNr":26120,"Titel":null},
                               {"MatrNr":null,"Titel":"Grundzüge"},
                               {"MatrNr":27550,"Titel":"Logik"},
                               {"MatrNr":28106,"Titel":"Ethik"},
                               {"MatrNr":28106,"Titel":"Wissenschaftstheorie"},
                               {"MatrNr":28106,"Titel":"Bioethik"},
                               {"MatrNr":28106,"Titel":"Der Wieer Kreis"},
                               {"MatrNr":29120,"Titel":"Grundzüge"},
                               {"MatrNr":29120,"Titel":"Ethik"},
                               {"MatrNr":29120,"Titel":"Mäeutik"},
                               {"MatrNr":null,"Titel":null},
                               {"MatrNr":25403,"Titel":"Glaube und Wissen"}])",
                           "test_schema", "test_table3");
    duckdb_web_disconnect(conn);
    ASSERT_EQ(response.statusCode, 0);
}

TEST(FFI, ImportJSONMixedTypes) {
    auto conn = duckdb_web_connect();
    dashql::FFIResponse response;
    duckdb_web_import_json(&response, conn,
                           R"([
                               {"MatrNr":26120,"Titel":null},
                               {"MatrNr":"Text","Titel":"Grundzüge"}])",
                           "test_schema", "test_table3");
    duckdb_web_disconnect(conn);
    ASSERT_NE(response.statusCode, 0);
}

};  // namespace
