// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/miniz_zipper.h"

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

    auto maybeCount = zipper.GetEntryCount();
    ASSERT_TRUE(maybeCount.ok()) << maybeCount.status().message();
    ASSERT_EQ(maybeCount.ValueUnsafe(), 7);
}

}  // namespace
