#pragma once

#include <algorithm>
#include <cassert>
#include <cstring>
#include <span>
#include <vector>

namespace dashql {

struct ChunkBufferEntryID {
    /// The chunk id
    size_t chunk_id;
    /// The chunk symbol id
    size_t chunk_entry_id;

    /// Constructor
    explicit ChunkBufferEntryID(size_t chunk_id = 0, size_t chunk_entry_id = 0)
        : chunk_id(chunk_id), chunk_entry_id(chunk_entry_id) {}
    /// Constructor
    ChunkBufferEntryID(const ChunkBufferEntryID& other)
        : chunk_id(other.chunk_id), chunk_entry_id(other.chunk_entry_id) {}
};

template <typename T, size_t InitialSize = 1024> struct ChunkBuffer {
    friend struct ConstForwardIterator;

   public:
    using value_type = T;

    /// Pseudo end iterator
    struct EndIterator {};
    /// A forward iterator
    struct ConstTupleIterator {
        /// The buffer
        const ChunkBuffer<T, InitialSize>& buffer;
        /// The chunk chunk
        size_t chunk_id;
        /// The local value id
        size_t chunk_value_id;

        /// Constructor
        ConstTupleIterator(const ChunkBuffer<T, InitialSize>& buffer, size_t chunk_id = 0, size_t local_value_id = 0)
            : buffer(buffer), chunk_id(chunk_id), chunk_value_id(local_value_id) {}
        /// Copy constructor
        ConstTupleIterator(const ConstTupleIterator& other)
            : buffer(other.buffer), chunk_id(other.chunk_id), chunk_value_id(other.chunk_value_id) {}
        /// Copy assignment
        ConstTupleIterator& operator=(const ConstTupleIterator& other) {
            assert(&buffer == &other.buffer);
            chunk_id = other.chunk_id;
            chunk_value_id = other.chunk_value_id;
            return *this;
        }
        /// Is at end?
        inline bool IsAtEnd() const { return chunk_value_id >= buffer.buffers[chunk_id].size(); }
        /// Increment operator
        inline ConstTupleIterator& operator++() {
            ++chunk_value_id;
            if (chunk_value_id >= buffer.buffers[chunk_id].size() && (chunk_id + 1) < buffer.buffers.size()) {
                ++chunk_id;
                chunk_value_id = 0;
            }
            return *this;
        }
        /// Compare with end iterator
        inline bool operator==(EndIterator&) const { return IsAtEnd(); }
        /// Compare with end iterator
        inline bool operator==(const EndIterator&) const { return IsAtEnd(); }
        /// Compare with entry id
        inline bool operator==(ChunkBufferEntryID id) const {
            return chunk_id == id.chunk_id && chunk_value_id == id.chunk_entry_id;
        }
        /// Compare with entry id
        inline bool operator!=(ChunkBufferEntryID id) const {
            return chunk_id != id.chunk_id || chunk_value_id != id.chunk_entry_id;
        }
        /// Compare with entry id
        inline bool operator>=(ChunkBufferEntryID id) const {
            return chunk_id > id.chunk_id || (chunk_id == id.chunk_id && chunk_value_id == id.chunk_entry_id);
        }
        /// Reference operator
        inline const T& operator*() const {
            assert(!IsAtEnd());
            return buffer.buffers[chunk_id][chunk_value_id];
        }
        /// Reference operator
        inline const T* operator->() const {
            assert(!IsAtEnd());
            return &buffer.buffers[chunk_id][chunk_value_id];
        }
    };

   protected:
    /// The buffers
    std::vector<std::vector<T>> buffers;
    /// The offsets
    std::vector<size_t> offsets;
    /// The next chunk size
    size_t next_chunk_size;
    /// The total tuple count
    size_t total_value_count;

    /// Grow the buffer
    void grow(size_t min_next_size = 0) {
        auto chunk_size = next_chunk_size;
        next_chunk_size = std::max<size_t>(min_next_size, next_chunk_size * 5 / 4);
        std::vector<T> nodes;
        nodes.reserve(chunk_size);
        buffers.push_back(std::move(nodes));
        offsets.push_back(total_value_count);
    }
    /// Find an offset in the buffer
    std::pair<size_t, size_t> find(size_t offset) const {
        auto offset_iter = std::upper_bound(offsets.begin(), offsets.end(), offset);
        assert(offset_iter > offsets.begin());
        auto chunk_id = offset_iter - offsets.begin() - 1;
        return {chunk_id, offsets[chunk_id]};
    }

   public:
    /// Constructor
    ChunkBuffer() : buffers(), offsets(), next_chunk_size(InitialSize), total_value_count(0) {
        buffers.reserve(64);
        offsets.reserve(64);
        grow();
    }
    /// Constructor
    explicit ChunkBuffer(std::vector<T> buffer) : ChunkBuffer() {
        total_value_count = buffer.size();
        offsets.push_back(total_value_count);
        buffers.push_back(std::move(buffer));
    }

    /// Get the size
    size_t GetSize() const { return total_value_count; }
    /// Is the buffer empty?
    bool IsEmpty() const { return GetSize() == 0; }
    /// Subscript operator
    T& operator[](size_t offset) {
        auto [chunk_id, chunk_offset] = find(offset);
        return buffers[chunk_id][offset - chunk_offset];
    }
    /// Subscript operator
    const T& operator[](size_t offset) const {
        auto [chunk_id, chunk_offset] = find(offset);
        return buffers[chunk_id][offset - chunk_offset];
    }
    /// Subscript operator
    T& operator[](ChunkBufferEntryID id) { return buffers[id.chunk_id][id.chunk_entry_id]; }
    /// Subscript operator
    const T& operator[](ChunkBufferEntryID id) const { return buffers[id.chunk_id][id.chunk_entry_id]; }
    /// Get the chunks
    auto& GetChunks() { return buffers; }
    /// Get the chunks
    auto& GetChunks() const { return buffers; }
    /// Get the chunk offsets
    auto& GetChunkOffsets() const { return offsets; }
    /// Get the last node
    T& GetLast() {
        assert(total_value_count > 0);
        return buffers.back().back();
    }
    /// Get a const iterator pointing at the last element
    ConstTupleIterator GetIteratorAtLast() const {
        size_t chunk_id = buffers.size() - 1;
        size_t local_value_id = buffers.back().size() - 1;
        return ConstTupleIterator{*this, chunk_id, local_value_id};
    }
    /// Clear the buffer
    void Clear() {
        buffers.erase(buffers.begin() + 1, buffers.end());
        offsets.erase(offsets.begin() + 1, offsets.end());
        next_chunk_size = InitialSize;
        total_value_count = 0;
        buffers[0].clear();
        offsets[0] = 0;
    }
    /// Push a node
    T& PushBack(T value) {
        auto* last = &buffers.back();
        if (last->size() == last->capacity()) {
            grow();
            last = &buffers.back();
        }
        last->push_back(std::move(value));
        ++total_value_count;
        return last->back();
    }
    /// Append multiple nodes
    std::span<T> EmplaceBackN(size_t n) {
        if (n == 0) return {};
        auto* last = &buffers.back();
        if ((last->capacity() - last->size()) < n) {
            grow(n);
            last = &buffers.back();
        }
        for (size_t i = 0; i < n; ++i) {
            last->emplace_back();
        }
        total_value_count += n;
        T* last_ptr = &last->back();
        last_ptr -= n - 1;
        return std::span<T>{last_ptr, n};
    }
    /// Apply a function for each value
    template <typename F> void ForEach(F fn) {
        size_t value_id = 0;
        for (auto& chunk : buffers) {
            for (auto& value : chunk) {
                fn(value_id++, value);
            }
        }
    }
    /// Apply a function for each value
    template <typename F> void ForEach(F fn) const {
        size_t value_id = 0;
        for (auto& chunk : buffers) {
            for (auto& value : chunk) {
                fn(value_id++, value);
            }
        }
    }
    /// Apply a function for each value
    template <typename F> void ForEachWhile(F fn) const {
        size_t value_id = 0;
        for (auto& chunk : buffers) {
            for (auto& value : chunk) {
                if (!fn(value_id++, value)) return;
            }
        }
    }
    /// Apply a function for each node in a range
    template <typename F> void ForEachIn(size_t begin, size_t count, F fn) {
        auto [chunk_id, chunk_offset] = find(begin);
        auto local_offset = begin - chunk_offset;
        auto global_offset = begin;
        while (count > 0) {
            auto& chunk = buffers[chunk_id];
            assert(chunk.size() >= local_offset);
            auto here = std::min(chunk.size() - local_offset, count);
            for (size_t i = 0; i < here; ++i) {
                fn(global_offset++, chunk[local_offset + i]);
            }
            count -= here;
            ++chunk_id;
            local_offset = 0;
        }
    }
    /// Flatten the buffer
    std::vector<T> Flatten() const {
        std::vector<T> flat;
        flat.resize(total_value_count);
        size_t writer = 0;
        for (auto& buffer : buffers) {
            std::memcpy(flat.data() + writer, buffer.data(), buffer.size() * sizeof(T));
            writer += buffer.size();
        }
        return flat;
    }

    /// Get the next entry for an id
    ChunkBufferEntryID GetNext(ChunkBufferEntryID entry) const {
        if ((entry.chunk_entry_id + 1) < buffers[entry.chunk_id].size()) {
            return ChunkBufferEntryID{entry.chunk_id, entry.chunk_entry_id + 1};
        } else if ((entry.chunk_id + 1) < buffers.size()) {
            return ChunkBufferEntryID{entry.chunk_id + 1, 0};
        } else {
            return entry;
        }
    }
    /// Get the previous entry for an id
    ChunkBufferEntryID GetPrevious(ChunkBufferEntryID entry) const {
        auto& chunk = buffers[entry.chunk_id];
        size_t prev_chunk_id = entry.chunk_id;
        size_t prev_chunk_symbol_id = entry.chunk_entry_id;
        if (entry.chunk_entry_id > 0) {
            prev_chunk_symbol_id = entry.chunk_entry_id - 1;
        } else if (entry.chunk_id > 0) {
            prev_chunk_id = entry.chunk_id - 1;
            auto& prev_chunk = buffers[prev_chunk_id];
            assert(!prev_chunk.empty());
            prev_chunk_symbol_id = prev_chunk.size() - 1;
        }
        return ChunkBufferEntryID{prev_chunk_id, prev_chunk_symbol_id};
    }
    /// Is the chunk entry at eof?
    bool IsAtEOF(ChunkBufferEntryID entry) const {
        auto& chunk = buffers[entry.chunk_id];
        return (entry.chunk_id + 1) >= buffers.size() && (entry.chunk_entry_id) >= chunk.size();
    }
    /// Get the id of the entry as if the chunk was flattened
    size_t GetFlatEntryID(ChunkBufferEntryID entry) const {
        size_t o = 0;
        for (size_t i = 0; i < entry.chunk_id; ++i) {
            o += buffers[i].size();
        }
        o += entry.chunk_entry_id;
        return o;
    }
};

}  // namespace dashql
