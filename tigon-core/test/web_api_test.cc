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
        CREATE TABLE foo(
            a int,
            b int
        );
        CREATE TABLE bar(
            c int,
            d int
        );
    )RAW");
    session.runQuery(R"RAW(
        INSERT INTO foo VALUES
            (1, 2),
            (3, 4),
            (5, 6);

        INSERT INTO bar VALUES
            (1, 2),
            (3, 4),
            (5, 6);
    )RAW");

    session.explainQuery("SELECT 1;");
    session.explainQuery(R"RAW(
        SELECT *
        FROM foo, bar
        WHERE a = c;
    )RAW");
}

}
