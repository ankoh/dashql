// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/miniz_zipper.h"

#include <iostream>
#include <sstream>

#include "arrow/csv/api.h"
#include "arrow/json/api.h"
#include "arrow/table.h"
#include "dashql/test/config.h"
#include "duckdb/common/file_system.hpp"
#include "duckdb/web/io/arrow_ifstream.h"
#include "duckdb/web/io/buffer_manager.h"
#include "duckdb/web/io/web_filesystem.h"
#include "gtest/gtest.h"
#include "rapidjson/document.h"

using namespace duckdb::web;
using namespace std;

namespace {

TEST(ZipperTest, LoadFile) {
    auto buffer_manager = std::make_shared<io::BufferManager>();
    auto path = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "all.zip";
    auto pathStr = path.string();

    Zipper zipper{buffer_manager};
    auto loadOK = zipper.LoadFromFile(path.c_str());
    ASSERT_TRUE(loadOK.ok()) << loadOK.message();

    auto maybeCount = zipper.ReadEntryCount();
    ASSERT_TRUE(maybeCount.ok()) << maybeCount.status().message();
    ASSERT_EQ(maybeCount.ValueUnsafe(), 7);

    std::vector<std::string> expectedFileNames = {
        "assistenten.parquet", "hoeren.parquet",      "professoren.parquet",   "pruefen.parquet",
        "studenten.parquet",   "vorlesungen.parquet", "vorraussetzen.parquet",
    };

    for (size_t i = 0; i < 7; ++i) {
        auto maybeInfo = zipper.ReadEntryInfoAsJSON(i);
        ASSERT_TRUE(maybeInfo.ok()) << maybeInfo.status().message();

        rapidjson::Document doc;
        doc.Parse(maybeInfo.ValueUnsafe().c_str());
        ASSERT_EQ(doc["fileName"].GetString(), expectedFileNames[i]);
    }
}

}  // namespace
