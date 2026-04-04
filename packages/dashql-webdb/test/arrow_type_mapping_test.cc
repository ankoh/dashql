#include "duckdb/web/arrow_type_mapping.h"

#include "arrow/type.h"
#include "duckdb.hpp"
#include "gtest/gtest.h"

namespace {

using duckdb::LogicalType;
using duckdb::LogicalTypeId;
using duckdb::web::mapArrowTypeToDuckDB;
using duckdb::web::mapDuckDBTypeToArrow;

TEST(ArrowTypeMapping, MapsPrimitiveArrowTypesToDuckDB) {
    auto bigint = mapArrowTypeToDuckDB(*arrow::int64());
    ASSERT_TRUE(bigint.ok()) << bigint.status().message();
    EXPECT_EQ(bigint->id(), LogicalTypeId::BIGINT);

    auto boolean = mapArrowTypeToDuckDB(*arrow::boolean());
    ASSERT_TRUE(boolean.ok()) << boolean.status().message();
    EXPECT_EQ(boolean->id(), LogicalTypeId::BOOLEAN);

    auto blob = mapArrowTypeToDuckDB(*arrow::binary());
    ASSERT_TRUE(blob.ok()) << blob.status().message();
    EXPECT_EQ(blob->id(), LogicalTypeId::BLOB);

    auto duration = mapArrowTypeToDuckDB(*arrow::duration(arrow::TimeUnit::MICRO));
    ASSERT_TRUE(duration.ok()) << duration.status().message();
    EXPECT_EQ(duration->id(), LogicalTypeId::TIME);
}

TEST(ArrowTypeMapping, MapsDecimalArrowTypesToDuckDBDecimal) {
    auto decimal = mapArrowTypeToDuckDB(*arrow::decimal128(12, 3));
    ASSERT_TRUE(decimal.ok()) << decimal.status().message();
    EXPECT_EQ(decimal->id(), LogicalTypeId::DECIMAL);
    EXPECT_EQ(decimal->ToString(), "DECIMAL(12,3)");
}

TEST(ArrowTypeMapping, MapsNestedArrowTypesToDuckDB) {
    auto list_type = arrow::list(arrow::field("item", arrow::int32()));
    auto list_result = mapArrowTypeToDuckDB(*list_type);
    ASSERT_TRUE(list_result.ok()) << list_result.status().message();
    EXPECT_EQ(list_result->id(), LogicalTypeId::LIST);
    EXPECT_EQ(list_result->ToString(), "INTEGER[]");

    auto struct_type = arrow::struct_({
        arrow::field("name", arrow::utf8()),
        arrow::field("count", arrow::int32()),
    });
    auto struct_result = mapArrowTypeToDuckDB(*struct_type);
    ASSERT_TRUE(struct_result.ok()) << struct_result.status().message();
    EXPECT_EQ(struct_result->id(), LogicalTypeId::STRUCT);
    EXPECT_EQ(struct_result->ToString(), "STRUCT(\"name\" VARCHAR, count INTEGER)");
}

TEST(ArrowTypeMapping, MapsDictionaryAndMapTypesUsingChildren) {
    auto dictionary = arrow::dictionary(arrow::int8(), arrow::utf8());
    auto dictionary_result = mapArrowTypeToDuckDB(*dictionary);
    ASSERT_TRUE(dictionary_result.ok()) << dictionary_result.status().message();
    EXPECT_EQ(dictionary_result->id(), LogicalTypeId::STRUCT);
    EXPECT_EQ(dictionary_result->ToString(), "STRUCT()");

    auto map_type = arrow::map(arrow::utf8(), arrow::int32());
    auto map_result = mapArrowTypeToDuckDB(*map_type);
    ASSERT_TRUE(map_result.ok()) << map_result.status().message();
    EXPECT_EQ(map_result->id(), LogicalTypeId::STRUCT);
    EXPECT_EQ(map_result->ToString(), "STRUCT(entries STRUCT(\"key\" VARCHAR, \"value\" INTEGER))");
}

TEST(ArrowTypeMapping, RejectsUnsupportedArrowTypes) {
    auto result = mapArrowTypeToDuckDB(*arrow::utf8_view());
    ASSERT_FALSE(result.ok());
    EXPECT_NE(std::string{result.status().message()}.find("DuckDB type mapping for:"), std::string::npos);
}

TEST(ArrowTypeMapping, MapsDuckDBTypesToArrow) {
    auto bigint = mapDuckDBTypeToArrow(LogicalType::BIGINT);
    ASSERT_TRUE(bigint.ok()) << bigint.status().message();
    EXPECT_EQ((*bigint)->id(), arrow::Type::INT64);

    auto varchar = mapDuckDBTypeToArrow(LogicalType::VARCHAR);
    ASSERT_TRUE(varchar.ok()) << varchar.status().message();
    EXPECT_EQ((*varchar)->id(), arrow::Type::STRING);

    auto date = mapDuckDBTypeToArrow(LogicalType::DATE);
    ASSERT_TRUE(date.ok()) << date.status().message();
    EXPECT_EQ((*date)->id(), arrow::Type::DATE64);
}

TEST(ArrowTypeMapping, RejectsUnsupportedDuckDBTypes) {
    auto result = mapDuckDBTypeToArrow(LogicalType::TIME);
    ASSERT_FALSE(result.ok());
    EXPECT_NE(std::string{result.status().message()}.find("type mapping not implemented for duckdb type"),
              std::string::npos);
}

}  // namespace
