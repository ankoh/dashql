#include "duckdb/web/arrow_insert_options.h"

#include "arrow/status.h"
#include "gtest/gtest.h"

namespace {

using duckdb::web::ArrowInsertOptions;

rapidjson::Document ParseJson(const char* json) {
    rapidjson::Document doc;
    doc.Parse(json);
    EXPECT_FALSE(doc.HasParseError());
    return doc;
}

TEST(ArrowInsertOptions, KeepsDefaultsForNonObjectInput) {
    ArrowInsertOptions options;
    auto doc = ParseJson("[]");
    auto status = options.ReadFrom(doc);
    ASSERT_TRUE(status.ok()) << status.message();
    EXPECT_EQ(options.schema_name, "");
    EXPECT_EQ(options.table_name, "");
    EXPECT_TRUE(options.create_new);
}

TEST(ArrowInsertOptions, ReadsExplicitFields) {
    ArrowInsertOptions options;
    auto doc = ParseJson(R"({"schema":"analytics","name":"events","create":false})");
    auto status = options.ReadFrom(doc);
    ASSERT_TRUE(status.ok()) << status.message();
    EXPECT_EQ(options.schema_name, "analytics");
    EXPECT_EQ(options.table_name, "events");
    EXPECT_FALSE(options.create_new);
}

TEST(ArrowInsertOptions, SupportsCreateNewAlias) {
    ArrowInsertOptions options;
    auto doc = ParseJson(R"({"createNew":false})");
    auto status = options.ReadFrom(doc);
    ASSERT_TRUE(status.ok()) << status.message();
    EXPECT_FALSE(options.create_new);
}

TEST(ArrowInsertOptions, IgnoresUnknownFields) {
    ArrowInsertOptions options;
    auto doc = ParseJson(R"({"schema":"public","name":"items","unknown":123})");
    auto status = options.ReadFrom(doc);
    ASSERT_TRUE(status.ok()) << status.message();
    EXPECT_EQ(options.schema_name, "public");
    EXPECT_EQ(options.table_name, "items");
    EXPECT_TRUE(options.create_new);
}

TEST(ArrowInsertOptions, RejectsInvalidCreateType) {
    ArrowInsertOptions options;
    auto doc = ParseJson(R"({"create":"yes"})");
    auto status = options.ReadFrom(doc);
    ASSERT_FALSE(status.ok());
    EXPECT_NE(std::string{status.message()}.find("type mismatch for field 'create': expected bool, received string"),
              std::string::npos);
}

TEST(ArrowInsertOptions, RejectsInvalidNameType) {
    ArrowInsertOptions options;
    auto doc = ParseJson(R"({"name":7})");
    auto status = options.ReadFrom(doc);
    ASSERT_FALSE(status.ok());
    EXPECT_NE(std::string{status.message()}.find("type mismatch for field 'name': expected string, received number"),
              std::string::npos);
}

TEST(ArrowInsertOptions, RejectsInvalidSchemaType) {
    ArrowInsertOptions options;
    auto doc = ParseJson(R"({"schema":false})");
    auto status = options.ReadFrom(doc);
    ASSERT_FALSE(status.ok());
    EXPECT_NE(std::string{status.message()}.find("type mismatch for field 'schema': expected string, received boolean"),
              std::string::npos);
}

}  // namespace
