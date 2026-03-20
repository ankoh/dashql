// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception

#include "dashql/utils/small_vector.h"

#include <algorithm>
#include <cassert>
#include <cstdlib>
#include <cstring>
#include <limits>

namespace dashql {

namespace {

[[noreturn]] static void report_size_overflow(size_t min_size, size_t max_size) {
    (void)min_size;
    (void)max_size;
    std::abort();
}

[[noreturn]] static void report_at_maximum_capacity(size_t max_size) {
    (void)max_size;
    std::abort();
}

template <class Size_T> static size_t getNewCapacity(size_t min_size, size_t type_size, size_t old_capacity) {
    constexpr size_t max_size = std::numeric_limits<Size_T>::max();

    if (min_size > max_size) report_size_overflow(min_size, max_size);
    if (old_capacity == max_size) report_at_maximum_capacity(max_size);

    size_t new_capacity = 2 * old_capacity + 1;
    return std::clamp(new_capacity, min_size, max_size);
}

static void* safe_malloc(size_t size) {
    void* Result = std::malloc(size);
    if (Result == nullptr) std::abort();
    return Result;
}

static void* safe_realloc(void* ptr, size_t size) {
    void* Result = std::realloc(ptr, size);
    if (Result == nullptr) std::abort();
    return Result;
}

static void* replaceAllocation(void* new_elements, size_t t_size, size_t new_capacity, size_t v_size = 0) {
    void* replace_element_buffer = safe_malloc(new_capacity * t_size);
    if (v_size) std::memcpy(replace_element_buffer, new_elements, v_size * t_size);
    std::free(new_elements);
    return replace_element_buffer;
}

}  // namespace

template <class Size_T>
void* SmallVectorBase<Size_T>::mallocForGrow(void* first_element, size_t min_size, size_t type_size,
                                             size_t& NewCapacity) {
    NewCapacity = getNewCapacity<Size_T>(min_size, type_size, this->capacity());
    void* new_element_buffer = safe_malloc(NewCapacity * type_size);
    if (new_element_buffer == first_element)
        new_element_buffer = replaceAllocation(new_element_buffer, type_size, NewCapacity);
    return new_element_buffer;
}

template <class Size_T> void SmallVectorBase<Size_T>::grow_pod(void* first_element, size_t min_size, size_t type_size) {
    size_t new_capacity = getNewCapacity<Size_T>(min_size, type_size, this->capacity());
    void* new_element_buffer;
    if (begin_x_ == first_element) {
        new_element_buffer = safe_malloc(new_capacity * type_size);
        if (new_element_buffer == first_element)
            new_element_buffer = replaceAllocation(new_element_buffer, type_size, new_capacity);
        std::memcpy(new_element_buffer, this->begin_x_, size() * type_size);
    } else {
        new_element_buffer = safe_realloc(this->begin_x_, new_capacity * type_size);
        if (new_element_buffer == first_element)
            new_element_buffer = replaceAllocation(new_element_buffer, type_size, new_capacity, size());
    }
    this->set_allocation_range(new_element_buffer, new_capacity);
}

template class SmallVectorBase<uint32_t>;

#if SIZE_MAX > UINT32_MAX
template class SmallVectorBase<uint64_t>;
#endif

}  // namespace dashql
