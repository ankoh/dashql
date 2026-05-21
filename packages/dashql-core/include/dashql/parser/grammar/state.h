#pragma once

#include <variant>

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/temp_allocator.h"

namespace dashql {
namespace parser {

/// A unique pointer backed by a memory pool.
/// Ownership is exclusive — on move, the source is nulled.
/// Call Destroy() to invoke the destructor (returning memory to the pool).
template <typename T> struct BackedUniquePtr {
    T* inner;
    BackedUniquePtr(T* value = nullptr) : inner(value) {}
    BackedUniquePtr(BackedUniquePtr&& other) : inner(other.inner) { other.inner = nullptr; }
    BackedUniquePtr& operator=(BackedUniquePtr&& other) {
        Destroy();
        inner = other.inner;
        other.inner = nullptr;
        return *this;
    }
    BackedUniquePtr(const BackedUniquePtr& other) : inner(other.inner) {
        // We only implement copy constructors to please the bison stack assignment.
        *const_cast<T**>(&other.inner) = nullptr;
    }
    BackedUniquePtr& operator=(const BackedUniquePtr& other) {
        Destroy();
        inner = other.inner;
        // We only implement copy assignment to please the bison stack assignment.
        *const_cast<T**>(&other.inner) = nullptr;
        return *this;
    }
    T* operator->() {
        assert(inner);
        return inner;
    }
    T& operator*() {
        assert(inner);
        return *inner;
    }
    void Destroy() {
        if (inner) {
            inner->~T();
            inner = nullptr;
        }
    }
};

/// A list of nodes that uses own allocators for both, the list container and the nodes
struct NodeList {
    /// A list element
    struct ListElement {
        /// The next list element
        ListElement* next = nullptr;
        /// The next list element
        ListElement* prev = nullptr;
        /// The element node
        buffers::parser::Node node;
        /// Constructor
        ListElement() = default;
    };
    using ListPool = TempNodePool<NodeList, 16>;
    using ListElementPool = TempNodePool<ListElement, 128>;

    /// The node list pool
    ListPool& list_pool;
    /// The node allocator
    ListElementPool& element_pool;
    /// The front of the list
    ListElement* first_element = nullptr;
    /// The back of the list
    ListElement* last_element = nullptr;
    /// The list size
    size_t element_count = 0;

    /// Constructor
    NodeList(ListPool& list_pool, ListElementPool& node_pool);
    /// Destructor
    ~NodeList();
    /// Move constructor
    NodeList(NodeList&& other) = default;

    /// Get the front
    inline ListElement* front() { return first_element; }
    /// Get the front
    inline ListElement* back() { return last_element; }
    /// Get the size
    inline size_t size() { return element_count; }
    /// Is empty?
    inline bool empty() { return size() == 0; }
    /// Prepend a node
    void push_front(buffers::parser::Node node);
    /// Append a node
    void push_back(buffers::parser::Node node);
    /// Append a list of nodes
    void append(std::initializer_list<buffers::parser::Node> nodes);
    /// Append a list of nodes
    void append(BackedUniquePtr<NodeList>&& other);
    /// Write elements into span
    void copy_into(std::span<buffers::parser::Node> nodes);
};

/// Helper for nary expressions
/// We defer the materialization of nary expressions to flatten conjunctions and disjunctions
struct NAryExpression {
    using Pool = TempNodePool<NAryExpression, 16>;

    /// The expression pool
    Pool& expression_pool;
    /// The location
    buffers::parser::SymbolSpan location;
    /// The expression operator
    buffers::parser::ExpressionOperator op;
    /// The expression operator node
    buffers::parser::Node opNode;
    /// The arguments
    BackedUniquePtr<NodeList> args;

    /// Constructor
    NAryExpression(Pool& pool, buffers::parser::SymbolSpan loc, buffers::parser::ExpressionOperator op,
                   buffers::parser::Node node, BackedUniquePtr<NodeList> args);
    /// Destructor
    ~NAryExpression();
};
/// An expression is either a proto node with materialized children, or an n-ary expression that can be flattened
using ExpressionVariant = std::variant<buffers::parser::Node, BackedUniquePtr<NAryExpression>>;

}  // namespace parser
}  // namespace dashql
