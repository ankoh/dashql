#include "duckdb/web/webdb.h"

#include "arrow/array.h"
#include "arrow/ipc/reader.h"
#include "arrow/io/memory.h"
#include "arrow/table.h"

#include "gtest/gtest.h"

using namespace duckdb::web;
using namespace std;

namespace {

std::shared_ptr<arrow::Table> ReadTable(const std::shared_ptr<arrow::Buffer>& buffer) {
    auto input = std::make_shared<arrow::io::BufferReader>(buffer);
    auto maybe_reader = arrow::ipc::RecordBatchFileReader::Open(input);
    EXPECT_TRUE(maybe_reader.ok()) << maybe_reader.status().message();
    if (!maybe_reader.ok()) {
        return nullptr;
    }
    auto reader = maybe_reader.MoveValueUnsafe();
    auto maybe_table = reader->ToTable();
    EXPECT_TRUE(maybe_table.ok()) << maybe_table.status().message();
    if (!maybe_table.ok()) {
        return nullptr;
    }
    return maybe_table.MoveValueUnsafe();
}

std::vector<int64_t> ReadInt64Column(const std::shared_ptr<arrow::Table>& table, int column_index) {
    std::vector<int64_t> values;
    auto column = table->column(column_index);
    for (int chunk_index = 0; chunk_index < column->num_chunks(); ++chunk_index) {
        auto chunk = std::static_pointer_cast<arrow::Int64Array>(column->chunk(chunk_index));
        for (int64_t row = 0; row < chunk->length(); ++row) {
            values.push_back(chunk->Value(row));
        }
    }
    return values;
}

std::vector<std::string> ReadStringColumn(const std::shared_ptr<arrow::Table>& table, int column_index) {
    std::vector<std::string> values;
    auto column = table->column(column_index);
    for (int chunk_index = 0; chunk_index < column->num_chunks(); ++chunk_index) {
        auto chunk = std::static_pointer_cast<arrow::StringArray>(column->chunk(chunk_index));
        for (int64_t row = 0; row < chunk->length(); ++row) {
            values.push_back(std::string{chunk->GetView(row)});
        }
    }
    return values;
}

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
    auto buffer = conn.RunQuery("SELECT v::BIGINT AS v FROM (VALUES (1), (2), (3)) AS t(v)");
    ASSERT_TRUE(buffer.ok()) << buffer.status().message();
    auto table = ReadTable(*buffer);
    ASSERT_NE(table, nullptr);
    ASSERT_EQ(table->num_rows(), 3);
    ASSERT_EQ(table->num_columns(), 1);
    EXPECT_EQ(ReadInt64Column(table, 0), (std::vector<int64_t>{1, 2, 3}));
}

TEST(WebDB, PendingQuery) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto buffer = conn.PendingQuery("SELECT v::BIGINT AS v FROM (VALUES (7), (8)) AS t(v)", false);
    ASSERT_TRUE(buffer.ok()) << buffer.status().message();
    auto table = ReadTable(*buffer);
    ASSERT_NE(table, nullptr);
    EXPECT_EQ(ReadInt64Column(table, 0), (std::vector<int64_t>{7, 8}));
}

TEST(WebDB, PrepareQuery) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto stmt = conn.CreatePreparedStatement("SELECT (? + 5)::BIGINT AS sum_value");
    ASSERT_TRUE(stmt.ok()) << stmt.status().message();
    auto buffer = conn.RunPreparedStatement(*stmt, "[4]");
    ASSERT_TRUE(buffer.ok()) << buffer.status().message();
    auto table = ReadTable(*buffer);
    ASSERT_NE(table, nullptr);
    EXPECT_EQ(ReadInt64Column(table, 0), (std::vector<int64_t>{9}));
    auto success = conn.ClosePreparedStatement(*stmt);
    ASSERT_TRUE(success.ok()) << success.message();
}

TEST(WebDB, PrepareQuerySupportsStringAndBoolArguments) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto stmt = conn.CreatePreparedStatement("SELECT ?::VARCHAR AS text_value, ?::BOOLEAN AS bool_value");
    ASSERT_TRUE(stmt.ok()) << stmt.status().message();
    auto buffer = conn.RunPreparedStatement(*stmt, R"(["dashql", true])");
    ASSERT_TRUE(buffer.ok()) << buffer.status().message();
    auto table = ReadTable(*buffer);
    ASSERT_NE(table, nullptr);
    EXPECT_EQ(ReadStringColumn(table, 0), (std::vector<std::string>{"dashql"}));
    auto bool_column = std::static_pointer_cast<arrow::BooleanArray>(table->column(1)->chunk(0));
    ASSERT_EQ(bool_column->length(), 1);
    EXPECT_TRUE(bool_column->Value(0));
}

TEST(WebDB, RunPreparedStatementRejectsInvalidJsonArguments) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto stmt = conn.CreatePreparedStatement("SELECT ? + 1");
    ASSERT_TRUE(stmt.ok()) << stmt.status().message();
    auto result = conn.RunPreparedStatement(*stmt, "not-json");
    ASSERT_FALSE(result.ok());
    EXPECT_NE(result.status().message().find("Failed to parse arguments JSON"), std::string::npos);
}

TEST(WebDB, RunPreparedStatementRejectsNonArrayArguments) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto stmt = conn.CreatePreparedStatement("SELECT ? + 1");
    ASSERT_TRUE(stmt.ok()) << stmt.status().message();
    auto result = conn.RunPreparedStatement(*stmt, "{}");
    ASSERT_FALSE(result.ok());
    EXPECT_NE(result.status().message().find("Arguments must be given as array"), std::string::npos);
}

TEST(WebDB, RunPreparedStatementRejectsUnknownStatement) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto result = conn.RunPreparedStatement(999, "[]");
    ASSERT_FALSE(result.ok());
    EXPECT_NE(result.status().message().find("statement not found"), std::string::npos);
}

TEST(WebDB, ClosePreparedStatementRejectsUnknownStatement) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto status = conn.ClosePreparedStatement(42);
    ASSERT_FALSE(status.ok());
    EXPECT_NE(status.message().find("statement not found"), std::string::npos);
}

TEST(WebDB, ClosedPreparedStatementCannotBeReused) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto stmt = conn.CreatePreparedStatement("SELECT ? + 1");
    ASSERT_TRUE(stmt.ok()) << stmt.status().message();
    ASSERT_TRUE(conn.ClosePreparedStatement(*stmt).ok());
    auto result = conn.RunPreparedStatement(*stmt, "[1]");
    ASSERT_FALSE(result.ok());
    EXPECT_NE(result.status().message().find("statement not found"), std::string::npos);
}

TEST(WebDB, ConnectAndDisconnect) {
    auto db = make_shared<WebDB>(NATIVE);
    auto* conn_a = db->Connect();
    auto* conn_b = db->Connect();
    ASSERT_NE(conn_a, nullptr);
    ASSERT_NE(conn_b, nullptr);
    ASSERT_NE(conn_a, conn_b);
    auto result_a = conn_a->RunQuery("SELECT 11::BIGINT AS v");
    auto result_b = conn_b->RunQuery("SELECT 22::BIGINT AS v");
    ASSERT_TRUE(result_a.ok()) << result_a.status().message();
    ASSERT_TRUE(result_b.ok()) << result_b.status().message();
    db->Disconnect(conn_a);
    db->Disconnect(conn_b);
}

TEST(WebDB, ResetClearsTablesForNewConnections) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    ASSERT_TRUE(conn.RunQuery("CREATE TABLE items(v INTEGER);").ok());
    ASSERT_TRUE(conn.RunQuery("INSERT INTO items VALUES (1), (2);").ok());
    ASSERT_TRUE(db->Reset().ok());
    WebDB::Connection new_conn{*db};
    auto result = new_conn.RunQuery("SELECT * FROM items");
    ASSERT_FALSE(result.ok());
}

TEST(WebDB, GetVersionReturnsNonEmptyString) {
    auto db = make_shared<WebDB>(NATIVE);
    EXPECT_FALSE(db->GetVersion().empty());
}

TEST(WebDB, PollPendingQueryStubReturnsNotImplemented) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto result = conn.PollPendingQuery();
    ASSERT_FALSE(result.ok());
    EXPECT_NE(result.status().message().find("PollPendingQuery stub"), std::string::npos);
}

TEST(WebDB, FetchQueryResultsStubReturnsNotImplemented) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    auto result = conn.FetchQueryResults();
    ASSERT_FALSE(result.arrow_buffer.ok());
    EXPECT_NE(result.arrow_buffer.status().message().find("FetchQueryResults stub"), std::string::npos);
}

TEST(WebDB, CancelPendingQueryStubReturnsFalse) {
    auto db = make_shared<WebDB>(NATIVE);
    WebDB::Connection conn{*db};
    EXPECT_FALSE(conn.CancelPendingQuery());
}

}  // namespace
