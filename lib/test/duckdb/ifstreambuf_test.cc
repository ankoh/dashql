// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/io/ifstreambuf.h"

#include <fstream>

#include "dashql/test/config.h"
#include "gtest/gtest.h"

using namespace duckdb::web;
using namespace std;

namespace {

TEST(InputStreamBuffer, istreambuf_iterator) {
    auto buffer_manager = std::make_shared<io::BufferManager>();
    auto path = dashql::test::SOURCE_DIR / ".." / "data" / "test.json";
    std::string expected;
    std::string have;
    {
        std::ifstream ifs{path};
        expected = {std::istreambuf_iterator<char>{ifs}, std::istreambuf_iterator<char>{}};
    }
    auto input = std::make_shared<io::InputFileStreamBuffer>(buffer_manager, path.c_str());
    {
        std::istream ifs{input.get()};
        have = {std::istreambuf_iterator<char>{ifs}, std::istreambuf_iterator<char>{}};
    }
    ASSERT_EQ(expected, have);
}

}  // namespace
