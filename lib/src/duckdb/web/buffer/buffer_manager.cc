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
BufferFrame::BufferFrame(uint64_t page_id, size_t size, list_position fifo_position, list_position lru_position)
    : page_id(page_id), buffer(), fifo_position(fifo_position), lru_position(lru_position) {}

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
    : page_size(page_size), page_count(page_count), files(), pages(), fifo(), lru() {}

/// Destructor
BufferManager::~BufferManager() {
    for (auto& entry : pages) {
        FlushPage(entry.second);
    }
}

void BufferManager::LoadPage(BufferFrame& page) {
    auto file_id = GetFileID(page.page_id);
    auto file_page_id = GetFilePageID(page.page_id);

    // Was the file opened already?
    File* file;
    if (auto it = files.find(file_id); it != files.end()) {
        file = it->second.get();
    } else {
        // Open file in WRITE mode because we may have to write dirty pages to it.
        auto filename = std::to_string(file_id);
        file = files.insert({file_id, File::OpenFile(filename.c_str(), File::WRITE)}).first->second.get();
    }

    // When the file is too small, resize it and zero out the data for it.
    // As the bytes in the file are zeroed anyway, we don't have to read the zeroes from disk.
    if (file->Size() < (file_page_id + 1) * page_size) {
        file->Resize((file_page_id + 1) * page_size);
        std::memset(page.buffer.data(), 0, page_size);
    } else {
        file->ReadBlock(file_page_id * page_size, page_size, page.buffer.data());
    }
    page.is_dirty = false;
}

void BufferManager::FlushPage(BufferFrame& page) {
    auto file_id = GetFileID(page.page_id);
    auto page_id = GetFilePageID(page.page_id);
    auto& file = *files.find(file_id)->second;
    file.WriteBlock(page.buffer.data(), page_id * page_size, page_size);
    page.is_dirty = false;
}

BufferFrame* BufferManager::FindPageToEvict() {
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
    auto* page_to_evict = FindPageToEvict();
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
    pages.erase(page_to_evict->page_id);
    return buffer;
}

/// Fix a page
BufferFrame& BufferManager::FixPage(uint64_t page_id, bool exclusive) {
    // Does the page exist?
    if (auto it = pages.find(page_id); it != pages.end()) {
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
    assert(pages.find(page_id) == pages.end());
    auto& page = pages.insert({page_id, BufferFrame{page_id, page_size, fifo.end(), lru.end()}}).first->second;
    page.buffer = AllocatePage();
    page.fifo_position = fifo.insert(fifo.end(), &page);
    page.Lock(exclusive);

    // Load the data
    LoadPage(page);
    return page;
}

void BufferManager::UnfixPage(BufferFrame& page, bool is_dirty) {
    page.is_dirty = page.is_dirty || is_dirty;
    page.Unlock();
}

void BufferManager::WritePages(uint32_t file_id) {
    auto lb = pages.lower_bound(static_cast<uint64_t>(file_id) << 32);
    auto ub = pages.lower_bound(static_cast<uint64_t>(file_id + 1) << 32);
    for (auto iter = lb; iter != ub; ++iter) {
        FlushPage(iter->second);
        if (iter->second.lru_position != lru.end()) {
            lru.erase(iter->second.lru_position);
        } else {
            assert(iter->second.fifo_position != fifo.end());
            fifo.erase(iter->second.fifo_position);
        }
    }
    pages.erase(lb, ub);
}

std::vector<uint64_t> BufferManager::get_fifo_list() const {
    std::vector<uint64_t> fifo_list;
    fifo_list.reserve(fifo.size());
    for (auto* page : fifo) {
        fifo_list.push_back(page->page_id);
    }
    return fifo_list;
}

std::vector<uint64_t> BufferManager::get_lru_list() const {
    std::vector<uint64_t> lru_list;
    lru_list.reserve(lru.size());
    for (auto* page : lru) {
        lru_list.push_back(page->page_id);
    }
    return lru_list;
}

}  // namespace web
}  // namespace duckdb
