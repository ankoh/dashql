#include "duckdb/web/io/buffer_manager.h"

#include <cassert>
#include <cstring>
#include <duckdb/common/file_system.hpp>
#include <iostream>
#include <limits>
#include <memory>
#include <string>
#include <tuple>
#include <utility>

/// Build a frame id
static constexpr uint64_t BuildFrameID(uint16_t file_id, uint64_t page_id = 0) {
    assert(page_id < (1ull << 48));
    return (page_id & (1ull << 48)) | (static_cast<uint64_t>(file_id) << 48);
}
/// Returns the file id for a given frame id which is contained in the 16
/// most significant bits of the page id.
static constexpr uint16_t GetFileID(uint64_t page_id) { return page_id >> 48; }
/// Returns the page id within its file for a given frame id. This
/// corresponds to the 48 least significant bits of the page id.
static constexpr uint64_t GetPageID(uint64_t page_id) { return page_id & ((1ull << 48) - 1); }

namespace duckdb {
namespace web {
namespace io {

/// Constructor
BufferFrame::BufferFrame(uint64_t frame_id, size_t size, list_position fifo_position, list_position lru_position)
    : frame_id(frame_id), fifo_position(fifo_position), lru_position(lru_position) {}

/// Lock the frame
void BufferFrame::Lock(bool exclusive) {
    if (exclusive && num_users > 0 && locked_exclusively) {
        // XXX throw, would have been a deadlock
    }
    locked_exclusively = exclusive;
    ++num_users;
}

/// Unlock the frame
void BufferFrame::Unlock() {
    locked_exclusively = false;
    --num_users;
}

/// Constructor
BufferManager::RegisteredFile::RegisteredFile(uint16_t file_id, std::string_view path,
                                              std::unique_ptr<duckdb::FileHandle> handle)
    : file_id(file_id), path(path), handle(std::move(handle)), references(0) {}

/// Constructor
BufferManager::FileRef::FileRef(BufferManager& buffer_manager, RegisteredFile& file)
    : buffer_manager_(buffer_manager), file_(&file) {
    ++file.references;
}

/// Constructor
BufferManager::FileRef::FileRef(FileRef&& other) : buffer_manager_(other.buffer_manager_), file_(other.file_) {
    other.file_ = nullptr;
}

/// Destructor
BufferManager::FileRef::~FileRef() { Release(); }

/// Release the file ref
void BufferManager::FileRef::Release() {
    if (file_) {
        buffer_manager_.ReleaseFile(*file_);
        file_ = nullptr;
    }
}

/// Destructor
BufferManager::FileRef& BufferManager::FileRef::operator=(FileRef&& other) {
    assert(&buffer_manager_ == &other.buffer_manager_);
    Release();
    file_ = other.file_;
    other.file_ = nullptr;
    return *this;
}

/// Constructor
BufferManager::BufferRef::BufferRef(BufferManager& buffer_manager, uint64_t frame_id, nonstd::span<char> data)
    : buffer_manager_(buffer_manager), frame_id_(frame_id), data_(data), is_dirty_(false) {}

/// Move Constructor
BufferManager::BufferRef::BufferRef(BufferRef&& other)
    : buffer_manager_(other.buffer_manager_),
      frame_id_(std::move(other.frame_id_)),
      data_(other.data_),
      is_dirty_(other.is_dirty_) {
    other.frame_id_.reset();
    other.data_ = {};
}

/// Move Constructor
BufferManager::BufferRef& BufferManager::BufferRef::operator=(BufferRef&& other) {
    assert(&buffer_manager_ == &other.buffer_manager_);
    Release();
    frame_id_ = other.frame_id_;
    data_ = other.data_;
    is_dirty_ = other.is_dirty_;
    other.frame_id_.reset();
    other.data_ = {};
    return *this;
}

/// Destructor
BufferManager::BufferRef::~BufferRef() { Release(); }

/// Constructor
void BufferManager::BufferRef::Release() {
    if (frame_id_.has_value()) {
        buffer_manager_.UnfixPage(*frame_id_, is_dirty_);
        frame_id_.reset();
        data_ = {};
    }
}

/// Constructor
BufferManager::BufferManager(std::unique_ptr<duckdb::FileSystem> filesystem, size_t page_size_bits)
    : page_size_bits(page_size_bits), filesystem(std::move(filesystem)) {}

/// Destructor
BufferManager::~BufferManager() {
    for (auto& entry : frames) {
        assert(entry.second.num_users == 0);
        FlushFrame(entry.second);
    }
}

BufferManager::FileRef BufferManager::OpenFile(std::string_view path, std::unique_ptr<duckdb::FileHandle> handle) {
    // Already added?
    if (auto iter = files_by_path.find(path); iter != files_by_path.end()) {
        return FileRef{*this, *files.at(iter->second)};
    }
    // More than
    if (allocated_file_ids == std::numeric_limits<uint16_t>::max()) {
        // XXX User wants to open more than 65535 files at the same time.
        //     We don't support that.
        throw "todo: throw something meaningful";
    }
    // Allocate file id
    uint16_t file_id;
    if (!free_file_ids.empty()) {
        file_id = free_file_ids.top();
        free_file_ids.pop();
    } else {
        ++allocated_file_ids;
    }
    // Create file
    auto iter = files.insert({file_id, std::make_unique<RegisteredFile>(file_id, path, std::move(handle))});
    auto& file = *iter.first->second;
    if (!file.handle) {
        file.handle = filesystem->OpenFile(file.path.c_str(), duckdb::FileFlags::FILE_FLAGS_WRITE);
    }
    file.file_size = filesystem->GetFileSize(*file.handle);
    return FileRef{*this, file};
}

void BufferManager::FlushFile(const FileRef& file_ref) {
    auto file_id = file_ref.file_->file_id;
    auto lb = frames.lower_bound(BuildFrameID(file_id));
    auto ub = frames.lower_bound(BuildFrameID(file_id + 1));
    for (auto iter = lb; iter != ub; ++iter) {
        FlushFrame(iter->second);
        if (iter->second.lru_position != lru.end()) {
            lru.erase(iter->second.lru_position);
        } else {
            assert(iter->second.fifo_position != fifo.end());
            fifo.erase(iter->second.fifo_position);
        }
    }
    frames.erase(lb, ub);
}

void BufferManager::ReleaseFile(RegisteredFile& file) {
    // Any open file references?
    assert(file.references > 0);
    --file.references;
    if (file.references > 0) return;

    // Find all frames
    auto file_id = file.file_id;
    auto lb = frames.lower_bound(BuildFrameID(file_id));
    auto ub = frames.lower_bound(BuildFrameID(file_id + 1));
    for (auto iter = lb; iter != ub; ++iter) {
        FlushFrame(iter->second);
        if (iter->second.lru_position != lru.end()) {
            lru.erase(iter->second.lru_position);
        } else {
            assert(iter->second.fifo_position != fifo.end());
            fifo.erase(iter->second.fifo_position);
        }
    }
    frames.erase(lb, ub);

    // Release file id
    files_by_path.erase(file.path);
    free_file_ids.push(file_id);
    files.erase(file_id);
    --allocated_file_ids;
}

void BufferManager::LoadFrame(BufferFrame& frame) {
    auto file_id = GetFileID(frame.frame_id);
    auto page_id = GetPageID(frame.frame_id);
    auto page_size = GetPageSize();

    // Determine the actual size of the frame
    assert(files.count(file_id));
    auto& file = *files.at(file_id);
    frame.data_size = *file.file_size - page_id * page_size;
    frame.is_dirty = false;

    // Read data into frame
    filesystem->Read(*file.handle, frame.buffer.data(), frame.data_size, page_id * page_size);
}

void BufferManager::FlushFrame(BufferFrame& frame) {
    assert(frame.num_users == 0);
    auto file_id = GetFileID(frame.frame_id);
    auto page_id = GetPageID(frame.frame_id);
    auto page_size = GetPageSize();

    // Write data from frame
    assert(files.count(file_id));
    auto& file = *files.at(file_id);
    filesystem->Write(*file.handle, frame.buffer.data(), frame.data_size, page_id * page_size);
    frame.is_dirty = false;
}

BufferFrame* BufferManager::FindFrameToEvict() {
    // Try FIFO list first
    for (auto* page : fifo) {
        if (page->num_users == 0) return page;
    }
    // If FIFO list is empty or all pages in it are in use, try LRU
    for (auto* page : lru) {
        if (page->num_users == 0) return page;
    }
    return nullptr;
}

std::vector<char> BufferManager::AllocatePage() {
    // Find a page to evict
    auto* page_to_evict = FindFrameToEvict();
    auto page_size = GetPageSize();
    if (page_to_evict == nullptr) {
        std::vector<char> buffer;
        buffer.resize(page_size);
        return buffer;
    }
    // Is dirty? Flush the page
    if (page_to_evict->is_dirty) {
        FlushFrame(*page_to_evict);
    }
    // Erase from queues
    if (page_to_evict->lru_position != lru.end()) {
        lru.erase(page_to_evict->lru_position);
    } else {
        assert(page_to_evict->fifo_position != fifo.end());
        fifo.erase(page_to_evict->fifo_position);
    }
    // Erase from dictionary
    auto buffer = std::move(page_to_evict->buffer);
    frames.erase(page_to_evict->frame_id);
    return buffer;
}

/// Get the file size
size_t BufferManager::GetFileSize(const FileRef& file) {
    assert(file.file_->file_size.has_value());
    return *file.file_->file_size;
}

/// Fix a page
BufferManager::BufferRef BufferManager::FixPage(const FileRef& file_ref, uint64_t page_id, bool exclusive) {
    // Does the page exist?
    auto file_id = file_ref.file_->file_id;
    auto frame_id = BuildFrameID(file_id, page_id);
    if (auto it = frames.find(frame_id); it != frames.end()) {
        auto& frame = it->second;

        // Is page in LRU queue?
        if (frame.lru_position != lru.end()) {
            lru.erase(frame.lru_position);
            frame.lru_position = lru.insert(lru.end(), &frame);
        } else {
            assert(frame.fifo_position != fifo.end());
            fifo.erase(frame.fifo_position);
            frame.fifo_position = fifo.end();
            frame.lru_position = lru.insert(lru.end(), &frame);
        }
        frame.Lock(exclusive);
        return BufferRef{*this, frame_id, frame.GetData()};
    }

    // Create a new page and don't insert it in the queues, yet.
    assert(frames.find(frame_id) == frames.end());
    auto& frame = frames.insert({frame_id, BufferFrame{frame_id, GetPageSize(), fifo.end(), lru.end()}}).first->second;
    frame.buffer = AllocatePage();
    frame.fifo_position = fifo.insert(fifo.end(), &frame);
    frame.Lock(exclusive);

    // Load the data
    LoadFrame(frame);
    return BufferRef{*this, frame_id, frame.GetData()};
}

void BufferManager::UnfixPage(size_t frame_id, bool is_dirty) {
    auto iter = frames.find(frame_id);
    if (iter == frames.end()) return;
    auto& frame = iter->second;
    frame.is_dirty = frame.is_dirty || is_dirty;
    frame.Unlock();
}

size_t BufferManager::Read(const FileRef& file, void* out, size_t n, size_t offset) {
    // Determine page & offset
    auto page_id = offset >> GetPageSizeShift();
    auto skip_here = offset - page_id * GetPageSize();
    auto read_here = std::min<size_t>(n, GetPageSize() - skip_here);

    // Read page
    auto page = FixPage(file, page_id, false);
    auto data = page.GetData();
    read_here = std::min<size_t>(read_here, data.size());
    std::memcpy(static_cast<char*>(out), data.data() + skip_here, read_here);
    return read_here;
}

size_t BufferManager::Write(const FileRef& file, void* in, size_t bytes, size_t offset) {
    // Determine page & offset
    auto page_id = offset >> GetPageSizeShift();
    auto skip_here = offset - page_id * GetPageSize();
    auto write_here = std::min<size_t>(bytes, GetPageSize() - skip_here);

    // Write page
    auto page = FixPage(file, page_id, false);
    auto data = page.GetData();
    write_here = std::min<size_t>(write_here, data.size());
    std::memcpy(data.data() + skip_here, static_cast<char*>(in), write_here);
    return write_here;
}

void BufferManager::Truncate(const FileRef& file_ref, size_t new_size) {
    FlushFile(file_ref);
    auto* file = file_ref.file_;
    filesystem->Truncate(*file->handle, new_size);
    file->file_size = new_size;
}

std::vector<uint64_t> BufferManager::get_fifo_list() const {
    std::vector<uint64_t> fifo_list;
    fifo_list.reserve(fifo.size());
    for (auto* page : fifo) {
        fifo_list.push_back(page->frame_id);
    }
    return fifo_list;
}

std::vector<uint64_t> BufferManager::get_lru_list() const {
    std::vector<uint64_t> lru_list;
    lru_list.reserve(lru.size());
    for (auto* page : lru) {
        lru_list.push_back(page->frame_id);
    }
    return lru_list;
}

}  // namespace io
}  // namespace web
}  // namespace duckdb
