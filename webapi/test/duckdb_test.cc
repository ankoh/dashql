//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "duckdb_webapi/api.h"
#include "duckdb_webapi/proto/query_plan_generated.h"
#include "gtest/gtest.h"
#include <sstream>

using namespace duckdb_webapi;
using namespace std;

namespace {

TEST(SQLTests, CreateTable) {
    auto db = make_shared<duckdb::DuckDB>();
    WebAPI::Session session{db};

    session.runQuery(R"RAW(
        CREATE TABLE r1(
            a int,
            b int
        );
        CREATE TABLE r2(
            c int,
            d int
        );
        CREATE TABLE r3(
            e int,
            f int
        );
    )RAW");
}

}
