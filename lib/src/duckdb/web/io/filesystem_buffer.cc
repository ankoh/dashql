#include "duckdb/web/io/filesystem_buffer.h"

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
    return (page_id & ((1ull << 48) - 1)) | (static_cast<uint64_t>(file_id) << 48);
}
/// Returns the file id for a given frame id which is contained in the 16
/// most significant bits of the page id.
static constexpr uint16_t GetFileID(uint64_t frame_id) { return frame_id >> 48; }
/// Returns the page id within its file for a given frame id. This
/// corresponds to the 48 least significant bits of the page id.
static constexpr uint64_t GetPageID(uint64_t frame_id) { return frame_id & ((1ull << 48) - 1); }

/// Helper to dump bytes
#if 0
static void dumpBytes(nonstd::span<char> bytes, size_t line_width = 30) {
    for (int i = 0; i < bytes.size(); i++) {
        auto c = bytes[i];
        if (i % line_width == 0) std::cout << "\n";
        std::cout << (std::isalnum(c) ? c : '.');
    }
    std::cout << std::endl;
}
#define DEBUG_DUMP_BYTES(bytes) dumpBytes(bytes)
#else
#define DEBUG_DUMP_BYTES(bytes)
#endif

namespace duckdb {
namespace web {
namespace io {

/// Constructor
FileSystemBufferFrame::FileSystemBufferFrame(uint64_t frame_id, size_t size, list_position fifo_position,
                                             list_position lru_position)
    : frame_id(frame_id), fifo_position(fifo_position), lru_position(lru_position) {}

/// Lock the frame
void FileSystemBufferFrame::Lock(bool exclusive) {
    if (exclusive && num_users > 0 && locked_exclusively) {
        // XXX throw, would have been a deadlock
    }
    locked_exclusively = exclusive;
    ++num_users;
}

/// Unlock the frame
void FileSystemBufferFrame::Unlock() {
    locked_exclusively = false;
    --num_users;
}

/// Constructor
FileSystemBuffer::RegisteredFile::RegisteredFile(uint16_t file_id, std::string_view path,
                                                 std::unique_ptr<duckdb::FileHandle> handle)
    : file_id(file_id), path(path), handle(std::move(handle)), references(0) {}

/// Constructor
FileSystemBuffer::FileRef::FileRef(std::shared_ptr<FileSystemBuffer> buffer_manager, RegisteredFile& file)
    : buffer_manager_(std::move(buffer_manager)), file_(&file) {
    ++file.references;
}

/// Constructor
FileSystemBuffer::FileRef::FileRef(const FileRef& other) : buffer_manager_(other.buffer_manager_), file_(other.file_) {
    ++file_->references;
}

/// Constructor
FileSystemBuffer::FileRef::FileRef(FileRef&& other)
    : buffer_manager_(std::move(other.buffer_manager_)), file_(other.file_) {
    other.buffer_manager_ = nullptr;
    other.file_ = nullptr;
}

/// Destructor
FileSystemBuffer::FileRef::~FileRef() { Release(); }

/// Release the file ref
void FileSystemBuffer::FileRef::Release() {
    if (!!file_) {
        buffer_manager_->ReleaseFile(*file_);
        buffer_manager_ = nullptr;
        file_ = nullptr;
    }
}

/// Copy assignment
FileSystemBuffer::FileRef& FileSystemBuffer::FileRef::operator=(const FileRef& other) {
    Release();
    buffer_manager_ = other.buffer_manager_;
    file_ = other.file_;
    ++file_->references;
    return *this;
}

/// Move assignment
FileSystemBuffer::FileRef& FileSystemBuffer::FileRef::operator=(FileRef&& other) {
    Release();
    buffer_manager_ = std::move(other.buffer_manager_);
    file_ = other.file_;
    other.file_ = nullptr;
    return *this;
}

/// Constructor
FileSystemBuffer::BufferRef::BufferRef(std::shared_ptr<FileSystemBuffer> buffer_manager, FileSystemBufferFrame& frame)
    : buffer_manager_(std::move(buffer_manager)), frame_(&frame) {}

/// Copy Constructor
FileSystemBuffer::BufferRef::BufferRef(const BufferRef& other)
    : buffer_manager_(other.buffer_manager_), frame_(other.frame_) {
    assert(!frame_->locked_exclusively);
    frame_->Lock(false);
}

/// Move Constructor
FileSystemBuffer::BufferRef::BufferRef(BufferRef&& other)
    : buffer_manager_(std::move(other.buffer_manager_)), frame_(std::move(other.frame_)) {
    other.buffer_manager_ = nullptr;
    other.frame_ = nullptr;
}

/// Copy Constructor
FileSystemBuffer::BufferRef& FileSystemBuffer::BufferRef::operator=(const BufferRef& other) {
    Release();
    buffer_manager_ = other.buffer_manager_;
    frame_ = other.frame_;
    frame_->Lock(false);
    return *this;
}

/// Move Constructor
FileSystemBuffer::BufferRef& FileSystemBuffer::BufferRef::operator=(BufferRef&& other) {
    Release();
    buffer_manager_ = std::move(other.buffer_manager_);
    frame_ = other.frame_;
    other.buffer_manager_ = nullptr;
    other.frame_ = nullptr;
    return *this;
}

/// Destructor
FileSystemBuffer::BufferRef::~BufferRef() { Release(); }
/// Constructor
void FileSystemBuffer::BufferRef::Release() {
    if (!!frame_) {
        buffer_manager_->UnfixPage(frame_->frame_id, frame_->is_dirty);
        buffer_manager_ = nullptr;
        frame_ = nullptr;
    }
}

/// Require a buffer frame to be of a certain size
void FileSystemBuffer::BufferRef::RequireSize(size_t n) {
    if (!frame_ || n < frame_->data_size) return;
    n = std::min<size_t>(n, buffer_manager_->GetPageSize());
    auto frame_id = frame_->frame_id;
    auto page_id = GetPageID(frame_id);
    auto file_id = GetFileID(frame_id);
    auto file_iter = buffer_manager_->files.find(file_id);
    if (file_iter == buffer_manager_->files.end()) return;
    auto required = page_id * buffer_manager_->GetPageSize() + n;
    buffer_manager_->RequireFileSize(*file_iter->second, required);
    frame_->data_size = std::max<size_t>(n, frame_->data_size);
}

/// Constructor
FileSystemBuffer::FileSystemBuffer(std::unique_ptr<duckdb::FileSystem> filesystem, size_t page_capacity,
                                   size_t page_size_bits)
    : page_size_bits(page_size_bits), page_capacity(page_capacity), filesystem(std::move(filesystem)) {}

/// Destructor
FileSystemBuffer::~FileSystemBuffer() {
    for (auto& entry : frames) {
        assert(entry.second.num_users == 0);
        FlushFrame(entry.second);
    }
}

FileSystemBuffer::FileRef FileSystemBuffer::OpenFile(std::string_view path,
                                                     std::unique_ptr<duckdb::FileHandle> handle) {
    // Already added?
    if (auto iter = files_by_path.find(path); iter != files_by_path.end()) {
        return FileRef{shared_from_this(), *files.at(iter->second)};
    }
    // File id overflow?
    if (allocated_file_ids == std::numeric_limits<uint16_t>::max()) {
        // XXX User wants to open more than 65535 files at the same time.
        //     We don't support that.
        throw std::runtime_error("cannot open more than 65535 files");
    }
    // Allocate file id
    uint16_t file_id;
    if (!free_file_ids.empty()) {
        file_id = free_file_ids.top();
        free_file_ids.pop();
    } else {
        file_id = allocated_file_ids++;
    }
    // Create file
    auto file_ptr = std::make_unique<RegisteredFile>(file_id, path, std::move(handle));
    auto& file = *file_ptr;
    files.insert({file_id, std::move(file_ptr)});
    if (!file.handle) {
        file.handle = filesystem->OpenFile(
            file.path.c_str(), duckdb::FileFlags::FILE_FLAGS_WRITE | duckdb::FileFlags::FILE_FLAGS_FILE_CREATE);
    }
    file.file_size = filesystem->GetFileSize(*file.handle);
    file.file_size_required = file.file_size;
    return FileRef{shared_from_this(), file};
}

void FileSystemBuffer::EvictFileFrames(RegisteredFile& file) {
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
}

void FileSystemBuffer::RequireFileSize(RegisteredFile& file, size_t bytes) {
    file.file_size_required = std::max(file.file_size_required, bytes);
}

void FileSystemBuffer::GrowFileIfRequired(RegisteredFile& file) {
    if (file.file_size_required <= file.file_size) return;
    filesystem->Truncate(*file.handle, file.file_size_required);
    file.file_size = file.file_size_required;
}

void FileSystemBuffer::ReleaseFile(RegisteredFile& file) {
    // Any open file references?
    assert(file.references > 0);
    --file.references;
    if (file.references > 0) return;

    // Evict all file frames
    EvictFileFrames(file);

    // Release file id
    files_by_path.erase(file.path);
    auto file_id = file.file_id;
    files.erase(file_id);
    free_file_ids.push(file_id);
}

void FileSystemBuffer::LoadFrame(FileSystemBufferFrame& frame) {
    auto file_id = GetFileID(frame.frame_id);
    auto page_id = GetPageID(frame.frame_id);
    auto page_size = GetPageSize();

    // Determine the actual size of the frame
    assert(files.count(file_id));
    auto& file = *files.at(file_id);
    frame.data_size = std::min<size_t>(file.file_size - page_id * page_size, GetPageSize());
    frame.is_dirty = false;

    // Read data into frame
    assert(frame.data_size <= GetPageSize());
    filesystem->Read(*file.handle, frame.buffer.data(), frame.data_size, page_id * page_size);
}

void FileSystemBuffer::FlushFrame(FileSystemBufferFrame& frame) {
    auto file_id = GetFileID(frame.frame_id);
    auto page_id = GetPageID(frame.frame_id);
    auto page_size = GetPageSize();
    if (!frame.is_dirty) return;

    // Write data from frame
    assert(files.count(file_id));
    auto& file = *files.at(file_id);
    GrowFileIfRequired(file);

    DEBUG_DUMP_BYTES(frame.GetData());

    // Write page to disk
    filesystem->Write(*file.handle, frame.buffer.data(), frame.data_size, page_id * page_size);
    frame.is_dirty = false;
}

FileSystemBufferFrame* FileSystemBuffer::FindFrameToEvict() {
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

std::vector<char> FileSystemBuffer::AllocateFrameBuffer() {
    // Still capacity?
    auto page_size = GetPageSize();
    if (frames.size() < page_capacity) {
        std::vector<char> buffer;
        buffer.resize(page_size);
        return buffer;
    }
    // Otherwise find a page to evict
    auto* page_to_evict = FindFrameToEvict();
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
    auto frame_id = page_to_evict->frame_id;
    frames.erase(frame_id);
    return buffer;
}

/// Get the file size
size_t FileSystemBuffer::GetFileSize(const FileRef& file) { return file.file_->file_size; }

/// Fix a page
FileSystemBuffer::BufferRef FileSystemBuffer::FixPage(const FileRef& file_ref, uint64_t page_id, bool exclusive) {
    // Does the page exist?
    assert(file_ref.file_ != nullptr);
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
        return BufferRef{shared_from_this(), frame};
    }

    // Create a new page and don't insert it in the queues, yet.
    assert(frames.find(frame_id) == frames.end());
    auto buffer = AllocateFrameBuffer();
    auto& frame =
        frames.insert({frame_id, FileSystemBufferFrame{frame_id, GetPageSize(), fifo.end(), lru.end()}}).first->second;
    frame.buffer = std::move(buffer);
    frame.fifo_position = fifo.insert(fifo.end(), &frame);
    frame.Lock(exclusive);

    // Load the data
    LoadFrame(frame);
    return BufferRef{shared_from_this(), frame};
}

void FileSystemBuffer::UnfixPage(size_t frame_id, bool is_dirty) {
    auto iter = frames.find(frame_id);
    if (iter == frames.end()) return;
    auto& frame = iter->second;
    frame.is_dirty = frame.is_dirty || is_dirty;
    frame.Unlock();
}

void FileSystemBuffer::FlushFile(const FileRef& file_ref) {
    auto file_id = file_ref.file_->file_id;
    auto lb = frames.lower_bound(BuildFrameID(file_id));
    auto ub = frames.lower_bound(BuildFrameID(file_id + 1));
    for (auto iter = lb; iter != ub; ++iter) {
        FlushFrame(iter->second);
    }
}

void FileSystemBuffer::FlushFile(std::string_view path) {
    if (auto file = files_by_path.find(path); file != files_by_path.end()) {
        auto lb = frames.lower_bound(BuildFrameID(file->second));
        auto ub = frames.lower_bound(BuildFrameID(file->second + 1));
        for (auto iter = lb; iter != ub; ++iter) {
            FlushFrame(iter->second);
        }
    }
}

void FileSystemBuffer::Flush() {
    for (auto& frame : frames) {
        FlushFrame(frame.second);
    }
}

size_t FileSystemBuffer::Read(const FileRef& file, void* out, size_t n, size_t offset) {
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

size_t FileSystemBuffer::Write(const FileRef& file, const void* in, size_t bytes, size_t offset) {
    // Determine page & offset
    auto page_id = offset >> GetPageSizeShift();
    auto skip_here = offset - page_id * GetPageSize();
    auto write_here = std::min<size_t>(bytes, GetPageSize() - skip_here);

    // Write page
    auto page = FixPage(file, page_id, false);
    write_here = std::min<size_t>(write_here, GetPageSize());
    page.RequireSize(skip_here + write_here);
    auto data = page.GetData();
    std::memcpy(data.data() + skip_here, static_cast<const char*>(in), write_here);
    page.MarkAsDirty();
    return write_here;
}

void FileSystemBuffer::Truncate(const FileRef& file_ref, size_t new_size) {
    auto* file = file_ref.file_;
    EvictFileFrames(*file);
    filesystem->Truncate(*file->handle, new_size);
    file->file_size = new_size;
    file->file_size_required = file->file_size;
}

std::vector<uint64_t> FileSystemBuffer::GetFIFOList() const {
    std::vector<uint64_t> fifo_list;
    fifo_list.reserve(fifo.size());
    for (auto* page : fifo) {
        fifo_list.push_back(page->frame_id);
    }
    return fifo_list;
}

std::vector<uint64_t> FileSystemBuffer::GetLRUList() const {
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