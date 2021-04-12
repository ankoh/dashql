#include "duckdb/web/buffer/buffer_manager.h"

#include <cassert>
#include <cstring>
#include <memory>
#include <string>
#include <tuple>
#include <utility>

namespace duckdb {
namespace web {

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
BufferManager::BufferManager(size_t page_size, size_t page_count)
    : page_size(page_size), files(), free_file_ids(), next_file_id(), frames(), fifo(), lru() {}

/// Destructor
BufferManager::~BufferManager() {
    for (auto& entry : frames) {
        FlushPage(entry.second);
    }
}

uint16_t BufferManager::AddFile(std::string_view path) {
    // Already added?
    if (auto iter = file_ids.find(path); iter != file_ids.end()) {
        return iter->second;
    }
    // Allocate file id
    uint16_t file_id;
    if (!free_file_ids.empty()) {
        file_id = free_file_ids.top();
        free_file_ids.pop();
    } else {
        ++next_file_id;
    }
    file_paths.insert({file_id, std::string{path}});
    // Return file id
    return file_id;
}

void BufferManager::FlushFile(uint16_t file_id) {
    // Find file path
    auto iter = file_paths.find(file_id);
    if (iter != file_paths.end()) {
        return;
    }
    auto path = std::move(iter->second);

    // Find all frames
    auto lb = frames.lower_bound(BuildFrameID(file_id));
    auto ub = frames.lower_bound(BuildFrameID(file_id + 1));
    for (auto iter = lb; iter != ub; ++iter) {
        FlushPage(iter->second);
        if (iter->second.lru_position != lru.end()) {
            lru.erase(iter->second.lru_position);
        } else {
            assert(iter->second.fifo_position != fifo.end());
            fifo.erase(iter->second.fifo_position);
        }
    }
    frames.erase(lb, ub);

    // Erase file mappings
    file_paths.erase(file_id);
    file_ids.erase(path);
    files.erase(file_id);
    free_file_ids.push(file_id);
}

void BufferManager::LoadFrame(BufferFrame& page) {
    auto file_id = GetFileID(page.frame_id);
    auto page_id = GetPageID(page.frame_id);

    // Was the file opened already?
    File* file;
    if (auto it = files.find(file_id); it != files.end()) {
        file = it->second.get();
    } else {
        // Open file in WRITE mode because we may have to write dirty pages to it.
        auto iter = file_paths.find(file_id);
        assert(iter != file_paths.end());
        file = files.insert({file_id, File::OpenFile(iter->second.c_str(), File::WRITE)}).first->second.get();
    }

    // When the file is too small, resize it and zero out the data for it.
    // As the bytes in the file are zeroed anyway, we don't have to read the zeroes from disk.
    if (file->Size() < (page_id + 1) * page_size) {
        file->Resize((page_id + 1) * page_size);
        std::memset(page.buffer.data(), 0, page_size);
    } else {
        file->ReadBlock(page_id * page_size, page_size, page.buffer.data());
    }
    page.is_dirty = false;
}

void BufferManager::FlushPage(BufferFrame& page) {
    auto file_id = GetFileID(page.frame_id);
    auto page_id = GetPageID(page.frame_id);
    auto& file = *files.find(file_id)->second;
    file.WriteBlock(page.buffer.data(), page_id * page_size, page_size);
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
    if (page_to_evict == nullptr) {
        std::vector<char> buffer;
        buffer.resize(page_size);
        return buffer;
    }
    // Is dirty? Flush the page
    if (page_to_evict->is_dirty) {
        FlushPage(*page_to_evict);
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
BufferFrame& BufferManager::FixPage(uint64_t page_id, bool exclusive) {
    // Does the page exist?
    if (auto it = frames.find(page_id); it != frames.end()) {
        auto& page = it->second;

        // Is page in LRU queue?
        if (page.lru_position != lru.end()) {
            lru.erase(page.lru_position);
            page.lru_position = lru.insert(lru.end(), &page);
        } else {
            assert(page.fifo_position != fifo.end());
            fifo.erase(page.fifo_position);
            page.fifo_position = fifo.end();
            page.lru_position = lru.insert(lru.end(), &page);
        }
        page.Lock(exclusive);
        return page;
    }

    // Create a new page and don't insert it in the queues, yet.
    assert(frames.find(page_id) == frames.end());
    auto& frame = frames.insert({page_id, BufferFrame{page_id, page_size, fifo.end(), lru.end()}}).first->second;
    frame.buffer = AllocatePage();
    frame.fifo_position = fifo.insert(fifo.end(), &frame);
    frame.Lock(exclusive);

    // Load the data
    LoadFrame(frame);
    return frame;
}

void BufferManager::UnfixPage(BufferFrame& frame, bool is_dirty) {
    frame.is_dirty = frame.is_dirty || is_dirty;
    frame.Unlock();
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

}  // namespace web
}  // namespace duckdb
