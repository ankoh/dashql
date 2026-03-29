#include "duckdb/web/webdb.h"

#include <filesystem>

#include "gtest/gtest.h"

using namespace duckdb::web;
using namespace std;
namespace fs = std::filesystem;

namespace {

TEST(WebDB, InvalidSQL) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto expected = conn.RunQuery(R"RAW(
        INVALID SQL
    )RAW");
    ASSERT_FALSE(expected.ok());
}

TEST(WebDB, RunQuery) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto buffer = conn.RunQuery("SELECT 1::TINYINT UNION ALL SELECT 2::TINYINT");
    ASSERT_TRUE(buffer.ok()) << buffer.status().message();
}

TEST(WebDB, PendingQuery) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto buffer = conn.PendingQuery("SELECT 1::TINYINT UNION ALL SELECT 2::TINYINT", false);
    ASSERT_TRUE(buffer.ok()) << buffer.status().message();
}

TEST(WebDB, PrepareQuery) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto stmt = conn.CreatePreparedStatement("SELECT ? + 5");
    ASSERT_TRUE(stmt.ok()) << stmt.status().message();
    auto buffer = conn.RunPreparedStatement(*stmt, "[4]");
    ASSERT_TRUE(buffer.ok()) << buffer.status().message();
    auto success = conn.ClosePreparedStatement(*stmt);
    ASSERT_TRUE(success.ok()) << success.message();
}

}  // namespace
