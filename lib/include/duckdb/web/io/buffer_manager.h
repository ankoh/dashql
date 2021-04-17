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

#include "duckdb/common/file_system.hpp"
#include "duckdb/web/io/default_filesystem.h"
#include "duckdb/web/io/web_filesystem.h"
#include "nonstd/span.h"

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
    /// The data size
    size_t data_size = 0;

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
    /// Get number of users
    auto GetUserCount() const { return num_users; }
    /// Returns a pointer to this page data
    nonstd::span<char> GetData() { return {buffer.data(), data_size}; }
};

class BufferManager : public std::enable_shared_from_this<BufferManager> {
   protected:
    /// A registered file
    struct RegisteredFile {
        /// The file id
        uint16_t file_id;
        /// The path
        std::string path;
        /// The file
        std::unique_ptr<duckdb::FileHandle> handle;
        /// The file size
        size_t file_size;
        /// The required file size.
        /// We grow files on flush if the user wrote past the end.
        /// For that purpose, we maintain a required file size here that can be bumped through RequireFileSize.
        size_t file_size_required;
        /// The references
        size_t references;

        /// Constructor
        RegisteredFile(uint16_t file_id, std::string_view path, std::unique_ptr<duckdb::FileHandle> file = nullptr);
    };

   public:
    /// A file reference
    class FileRef {
        friend class BufferManager;

       protected:
        /// The buffer manager
        std::shared_ptr<BufferManager> buffer_manager_;
        /// The file
        RegisteredFile* file_;
        /// The constructor
        explicit FileRef(std::shared_ptr<BufferManager> buffer_manager, RegisteredFile& file);

       public:
        /// Move constructor
        FileRef(FileRef&& other);
        /// Destructor
        ~FileRef();
        /// Move assignment
        FileRef& operator=(FileRef&& other);
        /// Is set?
        operator bool() const { return !!file_; }
        /// Get file id
        auto& GetFileID() const { return file_->file_id; }
        /// Get path
        auto& GetPath() const { return file_->path; }
        /// Get handle
        auto& GetHandle() const { return *file_->handle; }
        /// Release the file ref
        void Release();
    };

    /// A buffer reference
    class BufferRef {
        friend class BufferManager;

       protected:
        /// The buffer manager
        std::shared_ptr<BufferManager> buffer_manager_;
        /// The file
        BufferFrame* frame_;
        /// The constructor
        explicit BufferRef(std::shared_ptr<BufferManager> buffer_manager, BufferFrame& frame);

       public:
        /// Move constructor
        BufferRef(BufferRef&& other);
        /// Destructor
        ~BufferRef();
        /// Move assignment
        BufferRef& operator=(BufferRef&& other);
        /// Is set?
        operator bool() const { return !!frame_; }
        /// Access the data
        auto GetData() { return frame_->GetData(); }
        /// Release the file ref
        void Release();
        /// Mark as dirty
        void MarkAsDirty() { frame_->is_dirty = true; }
        /// Require a frame size
        void RequireSize(size_t n);
    };

   protected:
    /// The page size
    const size_t page_size_bits;

    /// The actual filesystem
    std::unique_ptr<duckdb::FileSystem> filesystem;
    /// Maps frame ids to their files
    std::unordered_map<uint16_t, std::unique_ptr<RegisteredFile>> files = {};
    /// The file ids
    std::unordered_map<std::string_view, uint16_t> files_by_path = {};
    /// The free file ids
    std::stack<uint16_t> free_file_ids = {};
    /// The next allocated file ids
    uint16_t allocated_file_ids = 0;

    /// Maps page_ids to BufferFrame objects of all pages that are currently in memory
    std::map<uint64_t, BufferFrame> frames = {};
    /// FIFO list of pages
    std::list<BufferFrame*> fifo = {};
    /// LRU list of pages
    std::list<BufferFrame*> lru = {};

    /// Evict all file frames
    void EvictFileFrames(RegisteredFile& file);
    /// Grow a file if required
    void GrowFileIfRequired(RegisteredFile& file);
    /// Require the file size to be at lest bytes large
    void RequireFileSize(RegisteredFile& file, size_t bytes);
    /// Release a file ref
    void ReleaseFile(RegisteredFile& file);
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

    /// Takes a `BufferFrame` reference that was returned by an earlier call to
    /// `FixPage()` and unfixes it. When `is_dirty` is / true, the page is
    /// written back to disk eventually.
    void UnfixPage(size_t frame_id, bool is_dirty);

   public:
    /// Constructor.
    /// Use 8KiB pages by default (1 << 13)
    BufferManager(std::unique_ptr<duckdb::FileSystem> filesystem = io::CreateDefaultFileSystem(),
                  size_t page_size_bits = 13);
    /// Destructor
    virtual ~BufferManager();

    /// Get the filesystem
    auto& GetFileSystem() { return filesystem; }
    /// Get the page size
    size_t GetPageSize() const { return 1 << page_size_bits; }
    /// Get the page shift
    auto GetPageSizeShift() const { return page_size_bits; }
    /// Get a page id from an offset
    size_t GetPageIDFromOffset(size_t offset) { return offset >> page_size_bits; }

    /// Open a file
    FileRef OpenFile(std::string_view path, std::unique_ptr<duckdb::FileHandle> file = nullptr);
    /// Get The file size
    size_t GetFileSize(const FileRef& file);

    /// Returns a reference to a `BufferFrame` object for a given page id. When
    /// the page is not loaded into memory, it is read from disk. Otherwise the
    /// loaded page is used.
    BufferRef FixPage(const FileRef& file, uint64_t page_id, bool exclusive);
    /// Flush all file frames to disk
    void FlushFile(const FileRef& file);
    /// Flush file matching name to disk
    void FlushFile(std::string_view path);
    /// Flush all outstanding frames to disk
    void Flush();

    /// Read at most n bytes
    size_t Read(const FileRef& file, void* buffer, size_t n, size_t offset);
    /// Write at most n bytes
    size_t Write(const FileRef& file, const void* buffer, size_t n, size_t offset);
    /// Truncate the file
    void Truncate(const FileRef& file, size_t new_size);

    /// Returns the page ids of all pages that are in the FIFO list in FIFO order.
    std::vector<uint64_t> GetFIFOList() const;
    /// Returns the page ids of all pages that are in the LRU list in LRU order.
    std::vector<uint64_t> GetLRUList() const;
};

}  // namespace io
}  // namespace web
}  // namespace duckdb

#endif
