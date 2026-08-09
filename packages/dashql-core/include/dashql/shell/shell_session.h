#pragma once

#include <coroutine>
#include <cstdint>
#include <deque>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "dashql/shell/arrow_renderer.h"
#include "dashql/shell/prompt_buffer.h"
#include "dashql/shell/task.h"

namespace dashql::shell {

enum class ShellStatus : uint32_t {
    kOk = 0,
    kInvalidArgument = 1,
    kArrowError = 2,
    kInternalError = 3,
    kPending = 4,
    kStaleEffect = 5,
    kBusy = 6,
};

enum class EffectType : uint32_t {
    kExecuteQuery = 1,
};

enum class EffectCompletionStatus : uint32_t {
    kSuccess = 0,
    kError = 1,
    kCancelled = 2,
};

struct ShellOperation {
    ShellStatus status = ShellStatus::kOk;
    std::string data;
};

struct EffectCompletion {
    EffectCompletionStatus status = EffectCompletionStatus::kSuccess;
    std::vector<uint8_t> data;
};

struct CompletionCandidate {
    std::string display_text;
    std::string completion_text;
    uint32_t target_offset = 0;
    uint32_t target_length = 0;
};

struct PromptSnapshot {
    ShellStatus status = ShellStatus::kOk;
    uint64_t revision = 0;
    uint32_t cursor_byte_offset = 0;
    std::string text;
    std::string message;
    uint32_t action = 0;
};

enum class PromptInputKey : uint32_t {
    kText = 0,
    kEnter = 1,
    kForceSubmit = 2,
    kTab = 3,
    kBackspace = 4,
    kDelete = 5,
    kLeft = 6,
    kRight = 7,
    kHistoryPrevious = 8,
    kHistoryNext = 9,
    kCancel = 10,
};

enum class PromptInputAction : uint32_t {
    kNone = 0,
    kSubmit = 1,
    kComplete = 2,
};

class ShellSession {
   public:
    explicit ShellSession(Catalog& catalog, uint32_t terminal_columns = 100);
    ~ShellSession();

    ShellSession(const ShellSession&) = delete;
    ShellSession& operator=(const ShellSession&) = delete;

    void Resize(uint32_t terminal_columns);
    PromptBuffer& prompt() { return prompt_; }
    const PromptBuffer& prompt() const { return prompt_; }
    PromptSnapshot SetPrompt(std::string_view text);
    PromptSnapshot InsertPrompt(std::string_view text);
    PromptSnapshot MovePromptLeft();
    PromptSnapshot MovePromptRight();
    PromptSnapshot DeletePromptBackward();
    PromptSnapshot DeletePromptForward();
    std::vector<CompletionCandidate> CompletePrompt(size_t limit);
    PromptSnapshot ApplyCompletion(const CompletionCandidate& candidate);
    PromptSnapshot ConsumePromptInput(PromptInputKey key, std::string_view text = {});
    ShellOperation SubmitPrompt();
    ShellOperation StartQuery(std::string_view query);
    ShellOperation CompleteEffect(uint64_t effect_id,
                                  EffectCompletionStatus status,
                                  std::span<const uint8_t> data);
    ShellOperation CancelEffect(uint64_t effect_id);
    std::string ExportHistory() const;
    ShellStatus ImportHistory(std::span<const uint8_t> data);

   private:
    struct EffectState {
        std::optional<EffectCompletion> completion;
    };

    struct PendingEffect {
        EffectType type;
        Task::Handle coroutine;
        std::shared_ptr<EffectState> state;
    };

    struct OutgoingEffect {
        uint64_t id;
        EffectType type;
        std::string payload;
    };

    class EffectAwaiter {
       public:
        EffectAwaiter(ShellSession& session, EffectType type, std::string payload);

        bool await_ready() const noexcept { return false; }
        void await_suspend(Task::Handle coroutine);
        EffectCompletion await_resume();

       private:
        ShellSession& session_;
        EffectType type_;
        std::string payload_;
        std::shared_ptr<EffectState> state_;
    };

    Task ExecuteQuery(std::string query);
    ShellOperation RenderArrowIPC(std::span<const uint8_t> data) const;
    void SuspendEffect(EffectType type,
                       std::string payload,
                       Task::Handle coroutine,
                       std::shared_ptr<EffectState> state);
    ShellOperation Resume(Task::Handle coroutine);
    ShellOperation CollectOperation(Task::Handle coroutine);
    ShellOperation EncodeOutgoingEffect();
    PromptSnapshot SnapshotPrompt(ShellStatus status = ShellStatus::kOk, std::string message = {});
    bool PromptIsComplete();
    void ResetHistoryCursor();
    void RememberPrompt(std::string_view query);
    void DestroyPendingEffects();

    PromptBuffer prompt_;
    ArrowRenderer renderer_;
    std::deque<std::string> history_;
    size_t history_cursor_ = 0;
    std::string history_draft_;
    uint64_t next_effect_id_ = 1;
    std::unordered_map<uint64_t, PendingEffect> pending_effects_;
    std::optional<OutgoingEffect> outgoing_effect_;
    std::optional<ShellOperation> completed_operation_;
};

}  // namespace dashql::shell
