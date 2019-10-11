//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/tools/web/web_api.h"
#include <gtest/gtest.h>
#include <sstream>

namespace {

TEST(WebAPITest, ExplainQuery) {
    auto db = std::make_shared<duckdb::DuckDB>();
    tigon::WebAPI::Session session{db};

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
    session.runQuery(R"RAW(
        INSERT INTO r1 VALUES
            (1, 2),
            (3, 4),
            (5, 6);

        INSERT INTO r2 VALUES
            (1, 2),
            (3, 4),
            (5, 6);
        INSERT INTO r3 VALUES
            (1, 2),
            (3, 4),
            (5, 6);
    )RAW");

    session.planQuery("SELECT 1;");
    ASSERT_EQ(session.getResponseStatus(), tigon::proto::StatusCode::Success);

    session.planQuery(R"RAW(
        SELECT *
        FROM r1, r2
        WHERE a = c;
    )RAW");
    ASSERT_EQ(session.getResponseStatus(), tigon::proto::StatusCode::Success);
}

}
