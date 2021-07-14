// Copyright (c) 2020 The DashQL Authors

#include "jmespath/jmespath.h"

#include <iostream>

#include "dashql/jmespath/jmespath.h"
#include "gtest/gtest.h"

using namespace std;
namespace jp = jmespath;

namespace dashql {
namespace {

TEST(JMESPathTest, Manual) {
    auto data = R"({
        "locations": [
            {"name": "Seattle", "state": "WA"},
            {"name": "New York", "state": "NY"},
            {"name": "Bellevue", "state": "WA"},
            {"name": "Olympia", "state": "WA"}
        ]
    })"_json;
    jp::Expression expression =
        "locations[?state == 'WA'].name | sort(@) | "
        "{WashingtonCities: join(', ', @)}";
    auto result = jp::search(expression, data);
    ASSERT_EQ(result, R"({"WashingtonCities": "Bellevue, Olympia, Seattle"})"_json);
}

TEST(JMEsPathTest, API) {
    std::string data = R"({
        "locations": [
            {"name": "Seattle", "state": "WA"},
            {"name": "New York", "state": "NY"},
            {"name": "Bellevue", "state": "WA"},
            {"name": "Olympia", "state": "WA"}
        ]
    })";
    std::string expression = R"(
        locations[?state == 'WA'].name | sort(@) | {WashingtonCities: join(', ', @)}
    )";
    auto result = JMESPath::Evaluate(expression.c_str(), data.c_str());
    ASSERT_TRUE(result.ok()) << result.status().message();
    ASSERT_EQ(result.ValueUnsafe(), R"({"WashingtonCities":"Bellevue, Olympia, Seattle"})");
}

}  // namespace
}  // namespace dashql
