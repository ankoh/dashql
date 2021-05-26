// Copyright (c) 2020 The DashQL Authors

#include "jmespath/jmespath.h"

#include <iostream>

#include "gtest/gtest.h"

using namespace std;
namespace jp = jmespath;

namespace {

TEST(JMESPathTest, Example1) {
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

}  // namespace
