#include "duckdb/web/io/buffer_manager.h"

#include <cassert>
#include <cstring>
#include <duckdb/common/file_system.hpp>
#include <limits>
#include <memory>
#include <string>
#include <tuple>
#include <utility>

/// Build a frame id
static constexpr uint16_t BuildFrameID(uint16_t file_id, uint64_t page_id = 0) {
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
BufferManager::BufferManager(std::shared_ptr<duckdb::FileSystem> filesystem, size_t page_size_bits)
    : page_size_bits(page_size_bits), filesystem(filesystem) {}

/// Destructor
BufferManager::~BufferManager() {
    for (auto& entry : frames) {
        FlushFrame(entry.second);
    }
}

BufferManager::FileRef BufferManager::AddFile(std::string_view path, std::unique_ptr<duckdb::FileHandle> file) {
    // Already added?
    if (auto iter = files_by_path.find(path); iter != files_by_path.end()) {
        return CreateFileRef(*files.at(iter->second));
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
    auto iter = files.insert({file_id, std::make_unique<RegisteredFile>(file_id, path, std::move(file))});
    // Return file id
    return CreateFileRef(*iter.first->second);
}

void BufferManager::FlushFile(FileRef& file_ref) {
    // Remove buffered file
    auto file_id = file_ref.file_->file_id;
    auto iter = files.find(file_id);
    if (iter != files.end()) {
        return;
    }
    auto& file = iter->second;

    // Find all frames
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
}

void BufferManager::ReleaseFile(BufferManager::FileRef&& file_ref) {
    if (!file_ref) return;

    // Get the file
    auto file_id = file_ref.file_->file_id;
    auto file_iter = files.find(file_id);
    if (file_iter != files.end()) return;
    auto& file = *file_iter->second;
    file_ref.file_ = nullptr;

    // Any open file references?
    assert(file.references > 0);
    --file.references;
    if (file.references > 0) return;

    // Find all frames
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
    files.erase(file_iter);
    --allocated_file_ids;
}

void BufferManager::LoadFrame(BufferFrame& page) {
    auto file_id = GetFileID(page.frame_id);
    auto page_id = GetPageID(page.frame_id);
    auto page_size = GetPageSize();

    // Was the file opened already?
    assert(files.count(file_id));
    auto& finfo = *files.at(file_id);
    if (!finfo.handle) {
        // Open file in WRITE mode because we may have to write dirty pages to it.
        finfo.handle = filesystem->OpenFile(finfo.path.c_str(), duckdb::FileFlags::FILE_FLAGS_WRITE);
    }

    // When the file is too small, resize it and zero out the data for it.
    // As the bytes in the file are zeroed anyway, we don't have to read the zeroes from disk.
    if (filesystem->GetFileSize(*finfo.handle) < (page_id + 1) * page_size) {
        filesystem->Truncate(*finfo.handle, (page_id + 1) * page_size);
        std::memset(page.buffer.data(), 0, page_size);
    } else {
        filesystem->Read(*finfo.handle, page.buffer.data(), page_size, page_id * page_size);
    }
    page.is_dirty = false;
}

void BufferManager::FlushFrame(BufferFrame& page) {
    auto file_id = GetFileID(page.frame_id);
    auto page_id = GetPageID(page.frame_id);
    auto page_size = GetPageSize();
    auto& finfo = *files.at(file_id);
    filesystem->Write(*finfo.handle, page.buffer.data(), page_size, page_id * page_size);
    page.is_dirty = false;
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

/// Fix a page
BufferManager::BufferRef BufferManager::FixPage(FileRef& file_ref, uint64_t page_id, bool exclusive) {
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
        return BufferRef{frame_id, frame.GetData()};
    }

    // Create a new page and don't insert it in the queues, yet.
    assert(frames.find(frame_id) == frames.end());
    auto& frame = frames.insert({frame_id, BufferFrame{frame_id, GetPageSize(), fifo.end(), lru.end()}}).first->second;
    frame.buffer = AllocatePage();
    frame.fifo_position = fifo.insert(fifo.end(), &frame);
    frame.Lock(exclusive);

    // Load the data
    LoadFrame(frame);
    return BufferRef{frame_id, frame.GetData()};
}

void BufferManager::UnfixPage(BufferRef buffer, bool is_dirty) {
    auto iter = frames.find(buffer.frame_id_);
    if (iter != frames.end()) return;
    auto& frame = iter->second;
    frame.is_dirty = frame.is_dirty || is_dirty;
    frame.Unlock();
    buffer.buffer_manager_ = nullptr;
    buffer.data_ = nullptr;
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
