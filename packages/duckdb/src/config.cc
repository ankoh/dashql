#include "duckdb/web/config.h"

#include <rapidjson/document.h>

#include <optional>

namespace duckdb {
namespace web {

/// Read the webdb config
WebDBConfig WebDBConfig::ReadFrom(std::string_view args_json) {
    auto config = WebDBConfig{.maximum_threads = 4,
                              .query =
                                  QueryConfig{
                                      .cast_bigint_to_double = std::nullopt,
                                      .cast_timestamp_to_date = std::nullopt,
                                      .cast_duration_to_time64 = true,
                                      .cast_decimal_to_double = std::nullopt,
                                  },
                              .arrow_lossless_conversion = false};
    rapidjson::Document doc;
    rapidjson::ParseResult ok = doc.Parse(args_json.data(), args_json.size());
    if (ok) {
        if (doc.HasMember("maximumThreads") && doc["maximumThreads"].IsNumber()) {
            config.maximum_threads = doc["maximumThreads"].GetInt();
        }
        if (doc.HasMember("query") && doc["query"].IsObject()) {
            auto q = doc["query"].GetObject();
            if (q.HasMember("queryPollingInterval") && q["queryPollingInterval"].IsNumber()) {
                config.query.query_polling_interval = q["queryPollingInterval"].GetInt64();
            }
            if (q.HasMember("castBigIntToDouble") && q["castBigIntToDouble"].IsBool()) {
                config.query.cast_bigint_to_double = q["castBigIntToDouble"].GetBool();
            }
            if (q.HasMember("castTimestampToDate") && q["castTimestampToDate"].IsBool()) {
                config.query.cast_timestamp_to_date = q["castTimestampToDate"].GetBool();
            }
            if (q.HasMember("castDurationToTime64") && q["castDurationToTime64"].IsBool()) {
                config.query.cast_duration_to_time64 = q["castDurationToTime64"].GetBool();
            }
            if (q.HasMember("castDecimalToDouble") && q["castDecimalToDouble"].IsBool()) {
                config.query.cast_decimal_to_double = q["castDecimalToDouble"].GetBool();
            }
        }
    }
    return config;
}

}  // namespace web
}  // namespace duckdb
