// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/miniz_zipper.h"

#include <filesystem>
#include <fstream>
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
namespace fs = std::filesystem;

namespace {

std::filesystem::path CreateTestFile() {
    static uint64_t NEXT_TEST_FILE = 0;
    auto cwd = fs::current_path();
    auto tmp = cwd / ".tmp";
    auto file = tmp / (std::string("test_zipper_") + std::to_string(NEXT_TEST_FILE++));
    if (!fs::is_directory(tmp) || !fs::exists(tmp)) fs::create_directory(tmp);
    if (fs::exists(file)) fs::remove(file);
    return file;
}

TEST(ZipperTest, LoadFile) {
    auto buffer_manager = std::make_shared<io::BufferManager>();
    auto path = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "all.zip";

    Zipper zipper{buffer_manager};
    auto load_status = zipper.LoadFromFile(path.c_str());
    ASSERT_TRUE(load_status.ok()) << load_status.message();

    auto maybe_count = zipper.ReadEntryCount();
    ASSERT_TRUE(maybe_count.ok()) << maybe_count.status().message();
    ASSERT_EQ(maybe_count.ValueUnsafe(), 7);

    std::vector<std::string> expected_file_names = {
        "assistenten.parquet", "hoeren.parquet",      "professoren.parquet",   "pruefen.parquet",
        "studenten.parquet",   "vorlesungen.parquet", "vorraussetzen.parquet",
    };

    for (size_t i = 0; i < 7; ++i) {
        auto maybe_info = zipper.ReadEntryInfoAsJSON(i);
        ASSERT_TRUE(maybe_info.ok()) << maybe_info.status().message();

        rapidjson::Document doc;
        doc.Parse(maybe_info.ValueUnsafe().c_str());
        ASSERT_EQ(doc["fileName"].GetString(), expected_file_names[i]);
    }
}

TEST(ZipperTest, ExtractToFile) {
    auto buffer_manager = std::make_shared<io::BufferManager>();
    auto all_path = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "all.zip";
    auto expected_path = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "assistenten.parquet";
    auto out_path = CreateTestFile();

    Zipper zipper{buffer_manager};
    auto load_status = zipper.LoadFromFile(all_path.c_str());
    ASSERT_TRUE(load_status.ok()) << load_status.message();

    auto maybe_count = zipper.ReadEntryCount();
    ASSERT_TRUE(maybe_count.ok()) << maybe_count.status().message();
    ASSERT_EQ(maybe_count.ValueUnsafe(), 7);

    auto maybe_info = zipper.ReadEntryInfoAsJSON(0);
    ASSERT_TRUE(maybe_info.ok()) << maybe_info.status().message();
    rapidjson::Document entry;
    entry.Parse(maybe_info.ValueUnsafe().c_str());
    ASSERT_EQ(std::string{entry["fileName"].GetString()}, std::string{"assistenten.parquet"});

    auto written = zipper.ExtractEntryToFile(0, out_path.c_str());
    ASSERT_EQ(entry["sizeUncompressed"].GetUint(), written.ValueUnsafe());

    buffer_manager->Flush();

    std::ifstream out_ifs{out_path};
    std::ifstream expected_ifs{expected_path};
    std::vector<char> out_buffer(std::istreambuf_iterator<char>{out_ifs}, {});
    std::vector<char> expected_buffer(std::istreambuf_iterator<char>{expected_ifs}, {});
    ASSERT_EQ(out_buffer, expected_buffer);
}

}  // namespace
