#include "duckdb/web/webdb_api_ffi.h"

#include <string>

#include "gtest/gtest.h"

namespace {

struct ResultOwner {
    DuckDBWebFFIResult* value = nullptr;

    ResultOwner() = default;
    explicit ResultOwner(DuckDBWebFFIResult* result) : value(result) {}
    ResultOwner(const ResultOwner&) = delete;
    ResultOwner& operator=(const ResultOwner&) = delete;
    ResultOwner(ResultOwner&& other) noexcept : value(other.value) { other.value = nullptr; }
    ResultOwner& operator=(ResultOwner&& other) noexcept {
        if (this != &other) {
            if (value != nullptr) {
                duckdb_web_ffi_result_destroy(value);
            }
            value = other.value;
            other.value = nullptr;
        }
        return *this;
    }
    ~ResultOwner() {
        if (value != nullptr) {
            duckdb_web_ffi_result_destroy(value);
        }
    }

    DuckDBWebFFIResult* get() const { return value; }
};

std::string ReadError(const DuckDBWebFFIResult* result) {
    auto* ptr = duckdb_web_ffi_result_error_message(result);
    auto len = duckdb_web_ffi_result_error_message_length(result);
    if (ptr == nullptr || len == 0) {
        return {};
    }
    return std::string{ptr, len};
}

std::string ReadString(const DuckDBWebFFIResult* result) {
    auto* ptr = duckdb_web_ffi_result_string(result);
    auto len = duckdb_web_ffi_result_string_length(result);
    if (ptr == nullptr || len == 0) {
        return {};
    }
    return std::string{ptr, len};
}

TEST(WebDBApiFFI, CreateGetVersionAndDestroy) {
    ResultOwner create{duckdb_web_ffi_database_create()};
    ASSERT_NE(create.get(), nullptr);
    ASSERT_EQ(duckdb_web_ffi_result_status_code(create.get()), DUCKDB_WEB_FFI_STATUS_OK);
    ASSERT_EQ(duckdb_web_ffi_result_kind(create.get()), DUCKDB_WEB_FFI_RESULT_KIND_DATABASE);

    auto* database = duckdb_web_ffi_result_database(create.get());
    ASSERT_NE(database, nullptr);

    ResultOwner version{duckdb_web_ffi_database_get_version(database)};
    ASSERT_EQ(duckdb_web_ffi_result_status_code(version.get()), DUCKDB_WEB_FFI_STATUS_OK);
    ASSERT_EQ(duckdb_web_ffi_result_kind(version.get()), DUCKDB_WEB_FFI_RESULT_KIND_STRING);
    EXPECT_FALSE(ReadString(version.get()).empty());

    duckdb_web_ffi_database_destroy(database);
}

TEST(WebDBApiFFI, ConnectRunQueryDisconnectAndDestroyConnectionWrapper) {
    ResultOwner create{duckdb_web_ffi_database_create()};
    auto* database = duckdb_web_ffi_result_database(create.get());
    ASSERT_NE(database, nullptr);

    ResultOwner connect{duckdb_web_ffi_database_connect(database)};
    ASSERT_EQ(duckdb_web_ffi_result_status_code(connect.get()), DUCKDB_WEB_FFI_STATUS_OK);
    ASSERT_EQ(duckdb_web_ffi_result_kind(connect.get()), DUCKDB_WEB_FFI_RESULT_KIND_CONNECTION);

    auto* connection = duckdb_web_ffi_result_connection(connect.get());
    ASSERT_NE(connection, nullptr);

    ResultOwner query{duckdb_web_ffi_connection_query_run(connection, "SELECT 1::BIGINT AS v")};
    ASSERT_EQ(duckdb_web_ffi_result_status_code(query.get()), DUCKDB_WEB_FFI_STATUS_OK);
    ASSERT_EQ(duckdb_web_ffi_result_kind(query.get()), DUCKDB_WEB_FFI_RESULT_KIND_BYTES);
    EXPECT_GT(duckdb_web_ffi_result_data_length(query.get()), 0u);
    EXPECT_NE(duckdb_web_ffi_result_data(query.get()), nullptr);

    ResultOwner disconnect{duckdb_web_ffi_database_disconnect(database, connection)};
    ASSERT_EQ(duckdb_web_ffi_result_status_code(disconnect.get()), DUCKDB_WEB_FFI_STATUS_OK);
    ASSERT_EQ(duckdb_web_ffi_result_kind(disconnect.get()), DUCKDB_WEB_FFI_RESULT_KIND_STATUS);

    duckdb_web_ffi_connection_destroy(connection);
    duckdb_web_ffi_database_destroy(database);
}

TEST(WebDBApiFFI, InvalidSqlReturnsErrorMessageAndArrowStatus) {
    ResultOwner create{duckdb_web_ffi_database_create()};
    auto* database = duckdb_web_ffi_result_database(create.get());
    ASSERT_NE(database, nullptr);

    ResultOwner connect{duckdb_web_ffi_database_connect(database)};
    auto* connection = duckdb_web_ffi_result_connection(connect.get());
    ASSERT_NE(connection, nullptr);

    ResultOwner query{duckdb_web_ffi_connection_query_run(connection, "INVALID SQL")};
    ASSERT_EQ(duckdb_web_ffi_result_status_code(query.get()), DUCKDB_WEB_FFI_STATUS_ERROR);
    EXPECT_FALSE(ReadError(query.get()).empty());
    EXPECT_NE(duckdb_web_ffi_result_arrow_status_code(query.get()), 0u);

    duckdb_web_ffi_connection_destroy(connection);
    duckdb_web_ffi_database_destroy(database);
}

TEST(WebDBApiFFI, ResetInvalidatesExistingConnectionHandle) {
    ResultOwner create{duckdb_web_ffi_database_create()};
    auto* database = duckdb_web_ffi_result_database(create.get());
    ASSERT_NE(database, nullptr);

    ResultOwner connect{duckdb_web_ffi_database_connect(database)};
    auto* connection = duckdb_web_ffi_result_connection(connect.get());
    ASSERT_NE(connection, nullptr);

    ResultOwner reset{duckdb_web_ffi_database_reset(database)};
    ASSERT_EQ(duckdb_web_ffi_result_status_code(reset.get()), DUCKDB_WEB_FFI_STATUS_OK);

    ResultOwner query{duckdb_web_ffi_connection_query_run(connection, "SELECT 1")};
    ASSERT_EQ(duckdb_web_ffi_result_status_code(query.get()), DUCKDB_WEB_FFI_STATUS_INVALID_ARGUMENT);
    EXPECT_NE(ReadError(query.get()).find("invalid"), std::string::npos);

    duckdb_web_ffi_connection_destroy(connection);
    duckdb_web_ffi_database_destroy(database);
}

TEST(WebDBApiFFI, FetchResultsMapsRetryStateWithoutThrowing) {
    ResultOwner create{duckdb_web_ffi_database_create()};
    auto* database = duckdb_web_ffi_result_database(create.get());
    ASSERT_NE(database, nullptr);

    ResultOwner connect{duckdb_web_ffi_database_connect(database)};
    auto* connection = duckdb_web_ffi_result_connection(connect.get());
    ASSERT_NE(connection, nullptr);

    ResultOwner fetch{duckdb_web_ffi_connection_query_fetch_results(connection)};
    ASSERT_NE(fetch.get(), nullptr);
    EXPECT_TRUE(
        duckdb_web_ffi_result_status_code(fetch.get()) == DUCKDB_WEB_FFI_STATUS_ERROR ||
        duckdb_web_ffi_result_kind(fetch.get()) == DUCKDB_WEB_FFI_RESULT_KIND_RETRY ||
        duckdb_web_ffi_result_kind(fetch.get()) == DUCKDB_WEB_FFI_RESULT_KIND_BYTES
    );

    duckdb_web_ffi_connection_destroy(connection);
    duckdb_web_ffi_database_destroy(database);
}

}  // namespace
