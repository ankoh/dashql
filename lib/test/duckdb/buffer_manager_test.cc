// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/io/buffer_manager.h"

#include <gtest/gtest.h>

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <memory>
#include <random>
#include <thread>
#include <vector>

#include "dashql/test/config.h"
#include "duckdb/web/io/web_filesystem.h"

using namespace duckdb::web;
using namespace dashql::test;
namespace fs = std::filesystem;

namespace {

struct TestableBufferManager : public io::BufferManager {
    TestableBufferManager() : io::BufferManager() {}

    auto& GetFrames() { return frames; }
};

std::filesystem::path CreateTestFile() {
    static uint64_t NEXT_TEST_FILE = 0;

    auto cwd = fs::current_path();
    auto tmp = cwd / ".tmp";
    auto file = tmp / (std::string("test_buffer_manager_") + std::to_string(NEXT_TEST_FILE++));
    if (!fs::is_directory(tmp) || !fs::exists(tmp)) fs::create_directory(tmp);
    if (fs::exists(file)) fs::remove(file);
    return file;
}

// NOLINTNEXTLINE
TEST(BufferManagerTest, FixSingle) {
    TestableBufferManager buffer_manager;
    auto filepath = CreateTestFile();
    auto page_size = buffer_manager.GetPageSize();
    auto entry_count = page_size / sizeof(uint64_t);
    auto data_size = entry_count * sizeof(uint64_t);
    std::vector<uint64_t> expected_values(entry_count, 123);

    // Write test values to page
    auto file = buffer_manager.OpenFile(filepath.c_str());
    ASSERT_EQ(file.GetFileID(), 0);
    {
        auto page = buffer_manager.FixPage(file, 0, true);
        ASSERT_EQ(page.GetData().size(), 0);
        page.RequireSize(data_size);
        std::memcpy(page.GetData().data(), expected_values.data(), data_size);
        page.MarkAsDirty();
    }
    buffer_manager.FlushFile(file);

    // Check buffer manager state
    ASSERT_EQ(buffer_manager.GetFrames().size(), 1);
    ASSERT_EQ(buffer_manager.GetFrames().begin()->second.GetUserCount(), 0);
    ASSERT_EQ(std::vector<uint64_t>{0}, buffer_manager.GetFIFOList());
    ASSERT_TRUE(buffer_manager.GetLRUList().empty());

    // Read test values from disk
    std::vector<uint64_t> values(entry_count);
    {
        auto page = buffer_manager.FixPage(file, 0, false);
        ASSERT_EQ(page.GetData().size(), data_size);
        std::memcpy(values.data(), page.GetData().data(), data_size);
    }

    // Check buffer manager state
    ASSERT_TRUE(buffer_manager.GetFIFOList().empty());
    ASSERT_EQ(std::vector<uint64_t>{0}, buffer_manager.GetLRUList());
    ASSERT_EQ(expected_values, values);
}

// NOLINTNEXTLINE
TEST(BufferManagerTest, PersistentRestart) {
    auto buffer_manager = std::make_unique<TestableBufferManager>();
    auto page_size = buffer_manager->GetPageSize();
    auto file1_path = CreateTestFile();
    auto file2_path = CreateTestFile();
    auto file3_path = CreateTestFile();

    std::vector<io::BufferManager::FileRef> files;
    files.push_back(buffer_manager->OpenFile(file1_path.c_str()));
    files.push_back(buffer_manager->OpenFile(file2_path.c_str()));
    files.push_back(buffer_manager->OpenFile(file3_path.c_str()));
    ASSERT_EQ(files[0].GetFileID(), 0);
    ASSERT_EQ(files[1].GetFileID(), 1);
    ASSERT_EQ(files[2].GetFileID(), 2);

    for (uint16_t file_id = 0; file_id < 3; ++file_id) {
        for (uint64_t page_id = 0; page_id < 10; ++page_id) {
            auto page = buffer_manager->FixPage(files[file_id], page_id, true);
            page.RequireSize(page_size);
            auto& value = *reinterpret_cast<uint64_t*>(page.GetData().data());
            value = file_id * 10 + page_id;
            page.MarkAsDirty();
        }
    }
    buffer_manager->Flush();
    files.clear();
    ASSERT_EQ(fs::file_size(file1_path), 10 * page_size);
    ASSERT_EQ(fs::file_size(file2_path), 10 * page_size);
    ASSERT_EQ(fs::file_size(file3_path), 10 * page_size);

    // Destroy the buffer manager and create a new one.
    buffer_manager = std::make_unique<TestableBufferManager>();
    files.push_back(buffer_manager->OpenFile(file1_path.c_str()));
    files.push_back(buffer_manager->OpenFile(file2_path.c_str()));
    files.push_back(buffer_manager->OpenFile(file3_path.c_str()));
    ASSERT_EQ(files[0].GetFileID(), 0);
    ASSERT_EQ(files[1].GetFileID(), 1);
    ASSERT_EQ(files[2].GetFileID(), 2);

    // Read all pages back
    for (uint16_t file_id = 0; file_id < 3; ++file_id) {
        for (uint64_t page_id = 0; page_id < 10; ++page_id) {
            auto page = buffer_manager->FixPage(files[file_id], page_id, false);
            EXPECT_EQ(page.GetData().size(), page_size);
            auto& value = *reinterpret_cast<uint64_t*>(page.GetData().data());
            EXPECT_EQ(file_id * 10 + page_id, value);
        }
    }
    files.clear();
}

}  // namespace
