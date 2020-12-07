// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_POD_VECTOR_H_
#define INCLUDE_DASHQL_COMMON_POD_VECTOR_H_

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <type_traits>

namespace dashql {

template <typename V> class PodVector {
    static_assert(std::is_pod_v<V>, "Element type must be a POD");

   public:
    typedef V* iterator;
    typedef const V* const_iterator;

   protected:
    static constexpr size_t MAX_SIZE = std::numeric_limits<size_t>::max() / sizeof(V);

    /// The buffer
    std::unique_ptr<char[]> buffer_;
    /// The element count
    size_t size_;
    /// The element capacity
    size_t capacity_;

   public:
    /// Constructor
    PodVector() : buffer_(nullptr), size_(0), capacity_(0) {}
    /// Constructor
    explicit PodVector(const PodVector& other) : buffer_(), size_(0), capacity_(0) {
        resize(other.size());
        std::memcpy(begin(), other.begin(), other.size() * sizeof(V));
    }
    /// Move assignment
    PodVector& operator=(const PodVector& other) {
        resize(other.size());
        std::memcpy(begin(), other.begin(), other.size() * sizeof(V));
    }

    /// Get the data?
    auto data() const { return buffer_.get(); }
    /// Get the size
    auto size() const { return size_; }
    /// Get the capacity
    auto capacity() const { return capacity_; }
    /// Is empty?
    auto empty() const { return size_ == 0; }

    /// Get the begin
    V* begin() { return reinterpret_cast<V*>(buffer_.get()); }
    /// Get the end
    V* end() { return begin() + size_; }
    /// Get the last element
    V& back() {
        assert(size_ > 0);
        return *(end() - 1);
    }
    /// Get the const begin
    const V* begin() const { return reinterpret_cast<const V*>(buffer_.get()); }
    /// Get the const end
    const V* end() const { return begin() + size_; }
    /// Get the last element
    const V& back() const { return *(end() - 1); }

    /// Subscript operator
    auto& operator[](size_t index) { return *(begin() + index); }
    /// Subscript operator
    auto& operator[](size_t index) const {
        assert(size_ > 0);
        return *(begin() + index);
    }

    /// Reserve bytes in the vector
    void reserve(size_t new_size) {
        if (new_size == 0) {
            buffer_.reset();
            size_ = 0;
            capacity_ = 0;
        }
        char* new_buffer_ptr_ = static_cast<char*>(realloc(buffer_.get(), new_size * sizeof(V)));
        if (!new_buffer_ptr_) throw std::bad_alloc();
        buffer_.release();
        buffer_.reset(new_buffer_ptr_);
    }

    /// Resize the vector
    void resize(size_t new_size) {
        constexpr size_t MIN_CAPACITY = 256 / sizeof(V);
        if (new_size < capacity_) {
            if ((new_size < capacity_ / 2) && (capacity_ > MIN_CAPACITY)) {
                reserve(new_size);
            }
        } else if (new_size > capacity_) {
            auto new_cap = capacity_;
            while (new_cap < new_size) {
                auto next_cap = new_cap + (new_cap >> 2) + 8;
                if (next_cap < new_cap || next_cap > MAX_SIZE) {
                    new_cap = MAX_SIZE;
                } else {
                    new_cap = next_cap;
                }
            }
            reserve(new_cap);
        }
        size_ = new_size;
    }

    /// Remove element at position
    void erase(size_t pos) {
        assert(pos < size_);
        std::memmove(begin() + pos, begin() + pos + 1, (size_ - pos - 1) * sizeof(V));
        resize(size_ - 1);
    }

    /// Insert element at position
    V* emplace(size_t pos) {
        assert(pos <= size_);
        if (pos < size_) {
            auto move = size_ - pos;
            resize(size_ + 1);
            std::memmove(begin() + pos + 1, begin() + pos, move * sizeof(V));
            return begin() + pos;
        } else {
            resize(size_ + 1);
            return begin() + size_ - 1;
        }
    }

    /// Insert at position
    void insert(size_t pos, const V& v) { *(this->emplace(pos)) = v; }
    /// Prepend a value
    void push_front(const V& v) { *(this->emplace(0U)) = v; }
    /// Append a value
    void push_back(const V& v) { *(this->emplace(this->size())) = v; }
    /// Remove the last element
    void pop_back() { erase(size_ - 1); }
};

}  // namespace dashql

#endif
