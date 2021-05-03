// Copyright (c) 2020 The DashQL Authors

#include <rapidjson/document.h>
#include <rapidjson/reader.h>

#include "dashql/common/json_sax.h"
#include "dashql/common/json_sax_sniffer.h"
#include "dashql/reader/json/json_reader.h"
#include "gtest/gtest.h"
#include "rapidjson/memorystream.h"

using namespace dashql;

TEST(JSONTest, ColumnMajorDetection) {
    std::string_view input_view{R"JSON({"a":[1, -2, 3], "b": ["c", "d", "e"], "f": [true, true, false]})JSON"};
    rapidjson::MemoryStream input_stream{input_view.data(), input_view.size()};

    // Parse the SAX document
    rapidjson::Reader reader;
    reader.IterativeParseInit();

    // Empty document?
    json::JSONSniffer stats_writer;
    auto& stats = stats_writer.stats;
    ASSERT_TRUE(reader.IterativeParseNext<rapidjson::kParseDefaultFlags>(input_stream, stats_writer));
    ASSERT_EQ(input_stream.Tell(), 1);
    ASSERT_EQ(stats.last.tag, json::SAXOpTag::OBJECT_START);

    // Column major mode
    std::vector<std::string> column_names;
    std::vector<std::pair<json::JSONSummary::ValueType, json::JSONSummary::NumberType>> column_types;
    while (!reader.IterativeParseComplete()) {
        ASSERT_TRUE(reader.IterativeParseNext<rapidjson::kParseDefaultFlags>(input_stream, stats_writer));
        if (stats.depth == 1) {
            switch (stats.last.tag) {
                case json::SAXOpTag::KEY:
                    column_names.push_back(std::string{std::get<std::string_view>(stats.last.argument)});
                    break;
                case json::SAXOpTag::ARRAY_END:
                    column_types.push_back({stats.GetMostFrequentValueType(), stats.GetMostFrequentNumberType()});
                    break;

                default:
                    // Unexpected
                    FAIL() << "Unexpected tag at nesting level 1";
                    break;
            }
        } else if (stats.depth == 2 && stats.last.tag == json::SAXOpTag::ARRAY_START) {
            stats.ResetCounters();
        }
    }
    std::vector<std::string> expected_column_names{"a", "b", "f"};
    std::vector<std::pair<json::JSONSummary::ValueType, json::JSONSummary::NumberType>> expected_column_types{
        {json::JSONSummary::ValueType::NUMBER, json::JSONSummary::NumberType::INT32},
        {json::JSONSummary::ValueType::STRING, json::JSONSummary::NumberType::UINT32},
        {json::JSONSummary::ValueType::BOOLEAN, json::JSONSummary::NumberType::UINT32},
    };
    ASSERT_EQ(column_names, expected_column_names);
    ASSERT_EQ(column_types, expected_column_types);
}
