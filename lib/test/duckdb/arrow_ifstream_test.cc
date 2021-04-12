// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/arrow_ifstream.h"

#include <sstream>

#include "dashql/test/config.h"
#include "duckdb/common/file_system.hpp"
#include "gtest/gtest.h"

using namespace duckdb::web;
using namespace std;

namespace {

TEST(ArrowInputFileStream, LoadCSV) {
    SeekableFileSystem fs;
    auto path = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "studenten.parquet";
    auto pathStr = path.string();

    InputFileStream in{fs, pathStr.c_str()};
}

}  // namespace
