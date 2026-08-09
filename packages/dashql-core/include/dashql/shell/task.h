#pragma once

#include <coroutine>
#include <exception>
#include <utility>

namespace dashql::shell {

class Task {
   public:
    struct promise_type;
    using Handle = std::coroutine_handle<promise_type>;

    struct promise_type {
        std::exception_ptr exception;

        Task get_return_object() noexcept { return Task{Handle::from_promise(*this)}; }
        std::suspend_always initial_suspend() const noexcept { return {}; }
        std::suspend_always final_suspend() const noexcept { return {}; }
        void return_void() const noexcept {}
        void unhandled_exception() noexcept { exception = std::current_exception(); }
    };

    explicit Task(Handle handle) noexcept : handle_{handle} {}
    Task(const Task&) = delete;
    Task& operator=(const Task&) = delete;
    Task(Task&& other) noexcept : handle_{std::exchange(other.handle_, {})} {}
    Task& operator=(Task&& other) noexcept {
        if (this != &other) {
            if (handle_) {
                handle_.destroy();
            }
            handle_ = std::exchange(other.handle_, {});
        }
        return *this;
    }
    ~Task() {
        if (handle_) {
            handle_.destroy();
        }
    }

    Handle Release() noexcept { return std::exchange(handle_, {}); }

   private:
    Handle handle_;
};

}  // namespace dashql::shell
