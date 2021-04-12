#ifndef INCLUDE_DUCKDB_WEB_BUFFER_FILE_H
#define INCLUDE_DUCKDB_WEB_BUFFER_FILE_H

#include <cstdint>
#include <memory>

namespace duckdb {
namespace web {

class File {
   public:
    /// File mode (read or write)
    enum Mode { READ, WRITE };

    /// Destructor
    virtual ~File() = default;

    /// Returns the `Mode` this file was opened with.
    virtual Mode GetMode() const = 0;
    /// Returns the current size of the file in bytes.
    virtual size_t Size() const = 0;
    /// Resizes the file to `new_size`.
    virtual void Resize(size_t new_size) = 0;
    /// Reads a block of the file. `offset + size` must not be larger than `size()`.
    virtual void ReadBlock(size_t offset, size_t size, char* block) = 0;

    /// Reads a block of the file and returns it.
    std::unique_ptr<char[]> ReadBlock(size_t offset, size_t size) {
        auto block = std::make_unique<char[]>(size);
        ReadBlock(offset, size, block.get());
        return block;
    }

    /// Writes a block to the file.
    /// `offset + size` must not be larger than `size()`.
    /// If you want to write past the end of the file, use `resize()` first.
    /// This function must not be used when the file was opened in `READ` mode.
    virtual void WriteBlock(const char* block, size_t offset, size_t size) = 0;

    /// Opens a file with the given mode. Existing files are never overwritten
    static std::unique_ptr<File> OpenFile(const char* filename, Mode mode);
    /// Opens a temporary file in `WRITE` mode. The file will be deleted automatically after use.
    static std::unique_ptr<File> MakeTemporaryFile();
};

}  // namespace web
}  // namespace duckdb

#endif
