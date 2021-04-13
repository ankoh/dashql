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

#include "duckdb/web/io/file.h"

namespace duckdb {
namespace web {
namespace io {

class BufferManager;

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
    void* GetData() { return buffer.data(); }
};

class BufferManager {
   public:
    /// A file reference
    class FileRef {
        friend class BufferManager;

       protected:
        /// The buffer manager
        BufferManager* buffer_manager_;
        /// The file id
        const uint16_t file_id_;
        /// The constructor
        explicit FileRef(BufferManager* buffer_manager, uint16_t file_id)
            : buffer_manager_(buffer_manager), file_id_(file_id) {}

       public:
        /// Move constructor
        FileRef(FileRef&& other) = default;
        /// Destructor
        ~FileRef();
        /// Move assignment
        FileRef& operator=(FileRef&& other);
        /// Release the file ref
        void Release();
        /// Is set?
        operator bool() const;
    };

    /// A buffer reference
    class BufferRef {
        friend class BufferManager;

       protected:
        /// The buffer manager
        BufferManager* buffer_manager_;
        /// The frame id
        const uint64_t frame_id_;
        /// The data
        void* data_;
        /// The constructor
        explicit BufferRef(uint64_t frame_id, void* data) : frame_id_(frame_id), data_(data) {}

       public:
        /// Move constructor
        BufferRef(BufferRef&& other);
        /// Destructor
        ~BufferRef();
        /// Move assignment
        BufferRef& operator=(BufferRef&& other);
        /// Access the data
        void* data() { return data_; }
        /// Release the file ref
        void Release();
        /// Is set?
        operator bool() const;
    };

   protected:
    /// A registered file
    struct RegisteredFile {
        /// The file id
        uint16_t file_id;
        /// The path
        std::string path;
        /// The file
        std::unique_ptr<File> file;
        /// The references
        size_t references;

        /// Constructor
        RegisteredFile(uint16_t file_id, std::string_view path, std::unique_ptr<File> file = nullptr);
    };

    /// The page size
    const size_t page_size_bits;

    /// Maps frame ids to their files
    std::unordered_map<uint16_t, RegisteredFile> files = {};
    /// The file ids
    std::unordered_map<std::string_view, uint16_t> files_by_path = {};
    /// The free file ids
    std::stack<uint16_t> free_file_ids = {};
    /// The next allocated file ids
    uint16_t allocated_file_ids = 0;

    /// Maps page_ids to BufferFrame objects of all pages that are currently in memory
    std::map<uint64_t, BufferFrame> frames = {};
    /// FIFO list of pages
    std::list<BufferFrame*> fifo;
    /// LRU list of pages
    std::list<BufferFrame*> lru;

    /// Create a file ref
    FileRef CreateFileRef(RegisteredFile& file);
    /// Loads the page from disk
    void LoadFrame(BufferFrame& frame);
    /// Writes the page to disk if it is dirty
    void FlushFrame(BufferFrame& frame);
    /// Returns the next page that can be evicted.
    /// Returns nullptr, when no page can be evicted.
    BufferFrame* FindFrameToEvict();
    /// Evicts a page from the buffer manager.
    /// Returns the data pointer of the evicted page or nullptr when no page can be evicted.
    std::vector<char> AllocatePage();

   public:
    /// Constructor.
    /// Use 8KiB pages by default (1 << 13)
    BufferManager(size_t page_size_bits = 13);
    /// Destructor
    ~BufferManager();

    /// Add a file
    FileRef AddFile(std::string_view path);
    /// Write all pages of a file
    void FlushFile(FileRef& file);
    /// Release a file ref
    void ReleaseFile(FileRef&& file);

    /// Get the page size
    size_t GetPageSize() const { return 1 << page_size_bits; }
    /// Get the page shift
    auto GetPageSizeShift() const { return page_size_bits; }
    /// Returns a reference to a `BufferFrame` object for a given page id. When
    /// the page is not loaded into memory, it is read from disk. Otherwise the
    /// loaded page is used.
    BufferRef FixPage(FileRef& file, uint64_t page_id, bool exclusive);
    /// Takes a `BufferFrame` reference that was returned by an earlier call to
    /// `FixPage()` and unfixes it. When `is_dirty` is / true, the page is
    /// written back to disk eventually.
    void UnfixPage(BufferRef buffer, bool is_dirty);

    /// Returns the page ids of all pages that are in the FIFO list in FIFO order.
    std::vector<uint64_t> get_fifo_list() const;
    /// Returns the page ids of all pages that are in the LRU list in LRU order.
    std::vector<uint64_t> get_lru_list() const;
};

}  // namespace io
}  // namespace web
}  // namespace duckdb

#endif
