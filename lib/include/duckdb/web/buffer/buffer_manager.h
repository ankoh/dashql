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
#include <stack>
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

    /// The frame id
    uint64_t frame_id;
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
    BufferFrame(uint64_t frame_id, size_t size, list_position fifo_position, list_position lru_position);
    /// Returns a pointer to this page data
    auto* GetData() const { return buffer.data(); }
};

class BufferManager {
   protected:
    /// The page size
    const size_t page_size;

    /// Maps frame ids to their files
    std::unordered_map<uint16_t, std::unique_ptr<File>> files = {};
    /// The free file ids
    std::stack<uint16_t> free_file_ids = {};
    /// The next allocated file ids
    uint16_t next_file_id = 0;
    /// The file ids
    std::unordered_map<std::string_view, uint16_t> file_ids = {};
    /// The file names
    std::unordered_map<uint16_t, std::string> file_paths = {};

    /// Maps page_ids to BufferFrame objects of all pages that are currently in memory
    std::map<uint64_t, BufferFrame> frames = {};
    /// FIFO list of pages
    std::list<BufferFrame*> fifo;
    /// LRU list of pages
    std::list<BufferFrame*> lru;

    /// Loads the page from disk
    void LoadFrame(BufferFrame& page);
    /// Writes the page to disk if it is dirty
    void FlushPage(BufferFrame& page);
    /// Returns the next page that can be evicted.
    /// Returns nullptr, when no page can be evicted.
    BufferFrame* FindFrameToEvict();
    /// Evicts a page from the buffer manager.
    /// Returns the data pointer of the evicted page or nullptr when no page can be evicted.
    std::vector<char> AllocatePage();

   public:
    /// Constructor
    BufferManager(size_t page_size, size_t page_count);
    /// Destructor
    ~BufferManager();

    /// Add a file
    uint16_t AddFile(std::string_view path);
    /// Write all pages of a file
    void FlushFile(uint16_t file_id);

    /// Get the page size
    auto GetPageSize() const { return page_size; }
    /// Returns a reference to a `BufferFrame` object for a given page id. When
    /// the page is not loaded into memory, it is read from disk. Otherwise the
    /// loaded page is used.
    BufferFrame& FixPage(uint64_t frame_id, bool exclusive);
    /// Takes a `BufferFrame` reference that was returned by an earlier call to
    /// `fix_page()` and unfixes it. When `is_dirty` is / true, the page is
    /// written back to disk eventually.
    void UnfixPage(BufferFrame& frame, bool is_dirty);

    /// Returns the page ids of all pages that are in the FIFO list in FIFO order.
    std::vector<uint64_t> get_fifo_list() const;
    /// Returns the page ids of all pages that are in the LRU list in LRU order.
    std::vector<uint64_t> get_lru_list() const;

    /// Returns the frame id for a given page id which is contained in the 32
    /// most significant bits of the page id.
    static constexpr uint16_t GetFileID(uint64_t page_id) { return page_id >> 48; }
    /// Returns the page id within its frame for a given page id. This
    /// corresponds to the 48 least significant bits of the page id.
    static constexpr uint64_t GetPageID(uint64_t page_id) { return page_id & ((1ull << 48) - 1); }
    /// Build a file page id
    static constexpr uint64_t BuildFrameID(uint32_t file_id, uint32_t page_id = 0) {
        return (static_cast<uint64_t>(file_id) << 32) | static_cast<uint64_t>(page_id);
    }
};

}  // namespace web
}  // namespace duckdb

#endif
