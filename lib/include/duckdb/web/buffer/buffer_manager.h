#ifndef INCLUDE_DUCKDB_WEB_BUFFER_BUFFER_MANAGER_H
#define INCLUDE_DUCKDB_WEB_BUFFER_BUFFER_MANAGER_H

#include <cstddef>
#include <cstdint>
#include <exception>
#include <list>
#include <map>
#include <memory>
#include <mutex>
#include <shared_mutex>
#include <unordered_map>
#include <vector>

#include "duckdb/web/buffer/file.h"

namespace duckdb {
namespace web {

class BufferFrame {
   protected:
    friend class BufferManager;
    /// A position in the LRU queue
    using list_position = std::list<BufferFrame*>::iterator;

    /// The page id
    uint64_t page_id;
    /// The data buffer
    std::vector<char> buffer;

    /// How many times this page has been fixed
    size_t num_users = 0;
    /// Is the page dirty?
    bool is_dirty = false;
    /// Is locked exclusively?
    bool locked_exclusively = false;

    /// Position of this page in the FIFO list
    list_position fifo_position;
    /// Position of this page in the LRU list
    list_position lru_position;

    /// Lock a buffer frame
    void Lock(bool exclusive);
    /// Unlock a buffer frame
    void Unlock();

   public:
    /// Constructor
    BufferFrame(uint64_t page_id, size_t size, list_position fifo_position, list_position lru_position);
    /// Returns a pointer to this page data
    auto* GetData() const { return buffer.data(); }
};

class BufferManager {
   protected:
    /// The page size
    size_t page_size;
    /// The page count
    size_t page_count;

    /// Maps segment ids to their files
    std::unordered_map<uint32_t, std::unique_ptr<File>> files;
    /// Maps page_ids to BufferFrame objects of all pages that are currently in memory
    std::map<uint64_t, BufferFrame> pages;
    /// FIFO list of pages
    std::list<BufferFrame*> fifo;
    /// LRU list of pages
    std::list<BufferFrame*> lru;

    /// Loads the page from disk
    void LoadPage(BufferFrame& page);
    /// Writes the page to disk if it is dirty
    void FlushPage(BufferFrame& page);
    /// Returns the next page that can be evicted.
    /// Returns nullptr, when no page can be evicted.
    BufferFrame* FindPageToEvict();
    /// Evicts a page from the buffer manager.
    /// Returns the data pointer of the evicted page or nullptr when no page can be evicted.
    std::vector<char> AllocatePage();

   public:
    /// Constructor
    BufferManager(size_t page_size, size_t page_count);
    /// Destructor
    ~BufferManager();

    /// Returns a reference to a `BufferFrame` object for a given page id. When
    /// the page is not loaded into memory, it is read from disk. Otherwise the
    /// loaded page is used.
    BufferFrame& FixPage(uint64_t page_id, bool exclusive);
    /// Takes a `BufferFrame` reference that was returned by an earlier call to
    /// `fix_page()` and unfixes it. When `is_dirty` is / true, the page is
    /// written back to disk eventually.
    void UnfixPage(BufferFrame& page, bool is_dirty);
    /// Write pages back
    void WritePages(uint32_t page_id);

    /// Returns the page ids of all pages that are in the FIFO list in FIFO order.
    std::vector<uint64_t> get_fifo_list() const;
    /// Returns the page ids of all pages that are in the LRU list in LRU order.
    std::vector<uint64_t> get_lru_list() const;

    /// Returns the segment id for a given page id which is contained in the 32
    /// most significant bits of the page id.
    static constexpr uint16_t GetFileID(uint64_t page_id) { return page_id >> 32; }
    /// Returns the page id within its segment for a given page id. This
    /// corresponds to the 48 least significant bits of the page id.
    static constexpr uint64_t GetFilePageID(uint64_t page_id) { return page_id & ((1ull << 32) - 1); }
};

}  // namespace web
}  // namespace duckdb

#endif
