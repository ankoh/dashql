#include "dashql/async_analysis.h"

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <limits>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <unordered_map>

#include <thread>

#ifdef __EMSCRIPTEN_PTHREADS__
#include <emscripten.h>
#endif

#include "dashql/exception.h"
#include "dashql/script.h"

namespace dashql {
namespace {

struct Job {
    uint32_t id;
    Script* script;
    bool parse_if_outdated;
    std::atomic<uint32_t> state{static_cast<uint32_t>(AsyncAnalysisJobState::QUEUED)};
    std::atomic<bool> cancelled{false};
    std::atomic<bool> released{false};
    uint32_t error_code = 0;
    std::string error_message;
};

static_assert(sizeof(std::atomic<uint32_t>) == sizeof(uint32_t));
constexpr size_t MAX_QUEUED_JOBS = 64;
constexpr uint32_t STD_EXCEPTION_ERROR = std::numeric_limits<uint32_t>::max() - 1;
constexpr uint32_t UNKNOWN_EXCEPTION_ERROR = std::numeric_limits<uint32_t>::max();

void NotifyTerminalState(const Job& job, AsyncAnalysisJobState state) {
#ifdef __EMSCRIPTEN_PTHREADS__
    MAIN_THREAD_ASYNC_EM_ASM(
        {
            if (Module.onDashQLAnalysisJobComplete) {
                Module.onDashQLAnalysisJobComplete($0, $1);
            }
        },
        job.id, static_cast<uint32_t>(state));
#else
    (void)job;
    (void)state;
#endif
}

void PublishState(Job& job, AsyncAnalysisJobState state) {
    job.state.store(static_cast<uint32_t>(state), std::memory_order_release);
#if defined(__cpp_lib_atomic_wait) && __cpp_lib_atomic_wait >= 201907L
    job.state.notify_all();
#endif
    if (state == AsyncAnalysisJobState::READY || state == AsyncAnalysisJobState::FAILED ||
        state == AsyncAnalysisJobState::CANCELLED) {
        NotifyTerminalState(job, state);
    }
}

class Executor {
   public:
    std::mutex mutex;
    std::condition_variable ready;
    std::deque<std::shared_ptr<Job>> queue;
    std::unordered_map<uint32_t, std::shared_ptr<Job>> jobs;
    std::atomic<uint32_t> next_id{1};

    Executor() {
        for (size_t i = 0; i < 2; ++i) {
            std::thread{[this] { Worker(); }}.detach();
        }
    }

    uint32_t Submit(Script& script, bool parse_if_outdated) {
        auto id = NextId();
        if (!script.AcquireAsyncLease(id)) {
            throw Exception(buffers::status::StatusCode::SCRIPT_BUSY);
        }
        auto job = std::make_shared<Job>();
        job->id = id;
        job->script = &script;
        job->parse_if_outdated = parse_if_outdated;
        {
            std::lock_guard lock{mutex};
            if (queue.size() >= MAX_QUEUED_JOBS) {
                script.ReleaseAsyncLease(id);
                throw std::runtime_error("asynchronous analysis queue is full");
            }
            jobs.emplace(id, job);
            queue.push_back(job);
        }
        ready.notify_one();
        return id;
    }

    std::shared_ptr<Job> Find(uint32_t id) {
        std::lock_guard lock{mutex};
        auto iter = jobs.find(id);
        return iter == jobs.end() ? nullptr : iter->second;
    }

    void Release(uint32_t id) {
        std::shared_ptr<Job> job;
        bool terminal = false;
        bool cancelled_queued = false;
        {
            std::lock_guard lock{mutex};
            auto iter = jobs.find(id);
            if (iter == jobs.end()) return;
            job = iter->second;
            job->released.store(true, std::memory_order_release);
            auto state = static_cast<AsyncAnalysisJobState>(job->state.load(std::memory_order_acquire));
            terminal = state == AsyncAnalysisJobState::READY || state == AsyncAnalysisJobState::FAILED ||
                       state == AsyncAnalysisJobState::CANCELLED;
            if (!terminal && state == AsyncAnalysisJobState::QUEUED) {
                auto queued = std::find(queue.begin(), queue.end(), job);
                if (queued != queue.end()) {
                    queue.erase(queued);
                    job->cancelled.store(true, std::memory_order_release);
                    cancelled_queued = true;
                    terminal = true;
                }
            }
            if (terminal) jobs.erase(iter);
        }
        if (cancelled_queued) PublishState(*job, AsyncAnalysisJobState::CANCELLED);
        if (terminal) job->script->ReleaseAsyncLease(job->id);
    }

   private:
    uint32_t NextId() {
        for (;;) {
            auto id = next_id.fetch_add(1, std::memory_order_relaxed);
            if (id != 0) return id;
        }
    }

    void Worker() {
        for (;;) {
            std::shared_ptr<Job> job;
            {
                std::unique_lock lock{mutex};
                ready.wait(lock, [&] { return !queue.empty(); });
                job = std::move(queue.front());
                queue.pop_front();
            }
            Run(job);
        }
    }

    void Run(const std::shared_ptr<Job>& job) {
        if (job->cancelled.load(std::memory_order_acquire)) {
            PublishState(*job, AsyncAnalysisJobState::CANCELLED);
            FinishReleased(job);
            return;
        }
        PublishState(*job, AsyncAnalysisJobState::ANALYZING);
        try {
            job->script->catalog.AnalyzeScriptAsync(*job->script, job->parse_if_outdated, job->cancelled);
            PublishState(*job, job->cancelled.load(std::memory_order_acquire)
                                   ? AsyncAnalysisJobState::CANCELLED
                                   : AsyncAnalysisJobState::READY);
        } catch (const Exception& e) {
            job->error_code = static_cast<uint32_t>(e.GetCode());
            job->error_message = e.what();
            PublishState(*job, AsyncAnalysisJobState::FAILED);
        } catch (const std::exception& e) {
            job->error_code = STD_EXCEPTION_ERROR;
            job->error_message = e.what();
            PublishState(*job, AsyncAnalysisJobState::FAILED);
        } catch (...) {
            job->error_code = UNKNOWN_EXCEPTION_ERROR;
            job->error_message = "unknown exception during asynchronous analysis";
            PublishState(*job, AsyncAnalysisJobState::FAILED);
        }
        FinishReleased(job);
    }

   public:
    void FinishReleased(const std::shared_ptr<Job>& job) {
        if (!job->released.load(std::memory_order_acquire)) return;
        {
            std::lock_guard lock{mutex};
            auto iter = jobs.find(job->id);
            if (iter == jobs.end() || iter->second.get() != job.get()) return;
            jobs.erase(iter);
        }
        job->script->ReleaseAsyncLease(job->id);
    }
};

Executor& GetExecutor() {
    // Intentionally process-lifetime: detached workers never observe destroyed executor state.
    static auto* executor = new Executor();
    return *executor;
}

}  // namespace

uint32_t AsyncAnalysisJobs::Submit(Script& script, bool parse_if_outdated) {
    return GetExecutor().Submit(script, parse_if_outdated);
}

AsyncAnalysisJobState AsyncAnalysisJobs::Poll(uint32_t job_id) {
    auto job = GetExecutor().Find(job_id);
    return job ? static_cast<AsyncAnalysisJobState>(job->state.load(std::memory_order_acquire))
               : AsyncAnalysisJobState::CANCELLED;
}

uint32_t AsyncAnalysisJobs::GetErrorCode(uint32_t job_id) {
    auto job = GetExecutor().Find(job_id);
    if (!job || job->state.load(std::memory_order_acquire) != static_cast<uint32_t>(AsyncAnalysisJobState::FAILED)) {
        return 0;
    }
    return job->error_code;
}

std::string AsyncAnalysisJobs::GetErrorMessage(uint32_t job_id) {
    auto job = GetExecutor().Find(job_id);
    if (!job || job->state.load(std::memory_order_acquire) != static_cast<uint32_t>(AsyncAnalysisJobState::FAILED)) {
        return {};
    }
    return job->error_message;
}

bool AsyncAnalysisJobs::Cancel(uint32_t job_id) {
    auto& executor = GetExecutor();
    auto job = executor.Find(job_id);
    if (!job) return false;
    auto state = static_cast<AsyncAnalysisJobState>(job->state.load(std::memory_order_acquire));
    if (state == AsyncAnalysisJobState::READY || state == AsyncAnalysisJobState::FAILED ||
        state == AsyncAnalysisJobState::CANCELLED) {
        return false;
    }
    job->cancelled.store(true, std::memory_order_release);
    bool removed = false;
    {
        std::lock_guard lock{executor.mutex};
        if (job->state.load(std::memory_order_acquire) == static_cast<uint32_t>(AsyncAnalysisJobState::QUEUED)) {
            auto iter = std::find(executor.queue.begin(), executor.queue.end(), job);
            if (iter != executor.queue.end()) {
                executor.queue.erase(iter);
                removed = true;
            }
        }
    }
    if (removed) {
        PublishState(*job, AsyncAnalysisJobState::CANCELLED);
#if defined(__cpp_lib_atomic_wait) && __cpp_lib_atomic_wait >= 201907L
        job->state.notify_all();
#endif
        executor.FinishReleased(job);
    }
    return true;
}

void AsyncAnalysisJobs::Release(uint32_t job_id) { GetExecutor().Release(job_id); }

}  // namespace dashql
