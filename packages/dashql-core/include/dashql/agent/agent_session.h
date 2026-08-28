#pragma once

#include <coroutine>
#include <cstdint>
#include <exception>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"

namespace dashql::editor {
class EditorSession;
}

namespace dashql::agent {

/// Default formatting policy for generated agent candidates.
buffers::formatting::FormattingConfigT DefaultAgentFormattingConfig();

/// Core-owned agent workflow that suspends for host-provided effects such as model calls.
/// The borrowed catalog must outlive the session and any coroutine currently suspended in it.
class AgentSession {
   public:
    /// Portable operation returned to the host after starting or resuming the workflow.
    using AgentOperation = buffers::agent::AgentOperationT;
    /// Portable request used to initialize a workflow run.
    using AgentStartRequest = buffers::agent::AgentStartRequestT;
    /// Portable result supplied by the host for the current pending effect.
    using AgentEffectCompletion = buffers::agent::AgentEffectCompletionT;

    /// Create an idle session borrowing the catalog and optional focused editor target.
    explicit AgentSession(Catalog& catalog, editor::EditorSession* target = nullptr,
                          buffers::formatting::FormattingConfigT formatting_config = DefaultAgentFormattingConfig());
    /// Destroy the suspended coroutine, if any.
    ~AgentSession();

    /// Start a new run and return its first pending effect or terminal operation.
    AgentOperation Start(const AgentStartRequest& request);
    /// Complete the matching pending effect and resume the workflow to its next suspension point.
    AgentOperation CompleteEffect(const AgentEffectCompletion& completion);
    /// Resume the pending effect as cancelled and return the resulting terminal operation.
    AgentOperation Cancel();

   private:
    /// FlatBuffer effect discriminator used by the host protocol.
    using AgentEffectType = buffers::agent::AgentEffectType;
    /// Requested or classified output intent.
    using AgentIntent = buffers::agent::AgentIntent;
    /// Current externally observable workflow phase.
    using AgentPhase = buffers::agent::AgentPhase;
    /// Error from the latest host protocol operation, independent of workflow phase.
    using AgentOperationError = buffers::agent::AgentOperationError;

    /// Owning wrapper for the root agent coroutine handle.
    struct Task {
        struct promise_type;
        /// Concrete handle type for the root workflow coroutine.
        using Handle = std::coroutine_handle<promise_type>;

        /// Coroutine state used to retain an unhandled workflow exception.
        struct promise_type {
            /// Exception thrown by the coroutine body, rethrown when collecting its operation.
            std::exception_ptr exception;
            /// Return the owning task for this coroutine frame.
            Task get_return_object() noexcept { return Task{Handle::from_promise(*this)}; }
            /// Keep the coroutine suspended until `Start` explicitly resumes it.
            std::suspend_always initial_suspend() const noexcept { return {}; }
            /// Keep the completed frame alive until the session collects and destroys it.
            std::suspend_always final_suspend() const noexcept { return {}; }
            /// Complete a successful workflow that stores its result on the session.
            void return_void() const noexcept {}
            /// Retain an exception so it never escapes directly across the C ABI.
            void unhandled_exception() noexcept { exception = std::current_exception(); }
        };

        /// Take ownership of a coroutine frame.
        explicit Task(Handle handle) : handle{handle} {}
        Task(const Task&) = delete;
        /// Transfer ownership of a coroutine frame.
        Task(Task&& other) noexcept : handle{std::exchange(other.handle, {})} {}
        /// Destroy the frame unless ownership was released to the session.
        ~Task() { if (handle) handle.destroy(); }
        /// Transfer the frame to the session's suspension machinery.
        Handle Release() { return std::exchange(handle, {}); }
        /// Owned coroutine frame, or an empty handle after release.
        Handle handle;
    };

    /// Deterministic scanner, parser, analyzer, and visualization verification result.
    struct VerifyResult {
        /// Scanner and parser diagnostics in source order.
        std::vector<std::string> parser_errors;
        /// Non-warning analyzer diagnostics.
        std::vector<std::string> analyzer_errors;
        /// Number of resolved visualization specifications in the candidate.
        uint32_t visualization_specs = 0;
    };

    /// Host effect result normalized into one coroutine-facing representation.
    struct EffectResult {
        /// Whether the host effect succeeded, failed, or was cancelled.
        buffers::agent::AgentEffectCompletionStatus status =
            buffers::agent::AgentEffectCompletionStatus::SUCCESS;
        /// Primary text result: model output, context, candidate, or error message.
        std::string value;
        /// Whether the host confirmed that it applied the proposal.
        bool applied = false;
    };

    /// Shared completion slot retained by an awaiter across coroutine suspension.
    struct EffectState { std::optional<EffectResult> result; };
    /// Metadata needed to validate and resume the one outstanding host effect.
    struct PendingEffect {
        /// Monotonic identifier used to reject stale effect completions.
        uint64_t id;
        /// Expected effect type, used to validate the completion payload.
        AgentEffectType type;
        /// Root workflow coroutine suspended on this effect.
        Task::Handle coroutine;
        /// Completion slot read by the effect awaiter after resumption.
        std::shared_ptr<EffectState> state;
    };

    /// Awaiter that publishes one host effect and yields its normalized completion.
    class EffectAwaiter {
       public:
        /// Create an awaiter owning the effect request until suspension.
        EffectAwaiter(AgentSession& session, std::unique_ptr<buffers::agent::AgentEffectT> effect)
            : session_{session}, effect_{std::move(effect)}, state_{std::make_shared<EffectState>()} {}
        /// Host effects always suspend the workflow.
        bool await_ready() const noexcept { return false; }
        /// Register the effect and its suspended coroutine with the session.
        void await_suspend(Task::Handle coroutine);
        /// Consume the completion installed by `CompleteEffect`.
        EffectResult await_resume();

       private:
        /// Session that owns the pending effect and root coroutine.
        AgentSession& session_;
        /// Effect request transferred to the session when the coroutine suspends.
        std::unique_ptr<buffers::agent::AgentEffectT> effect_;
        /// Completion slot shared with the session's pending-effect record.
        std::shared_ptr<EffectState> state_;
    };

    /// Run classification, context resolution, generation, verification, repair, and application.
    Task Run();
    /// Suspend for an intent-classification, generation, or repair model request.
    EffectAwaiter AwaitModel(buffers::agent::AgentModelRequestKind kind);
    /// Suspend while the host assembles notebook-specific prompt context.
    EffectAwaiter AwaitContext();
    /// Suspend while the host applies the verified proposal to notebook state.
    EffectAwaiter AwaitApply(const VerifyResult& verify);
    /// Publish an effect and retain everything required to resume its coroutine.
    void SuspendEffect(std::unique_ptr<buffers::agent::AgentEffectT> effect, Task::Handle coroutine,
                       std::shared_ptr<EffectState> state);
    /// Resume a workflow coroutine and collect its next operation.
    AgentOperation Resume(Task::Handle coroutine);
    /// Convert a suspended or completed coroutine into a portable host operation.
    AgentOperation CollectOperation(Task::Handle coroutine);
    /// Build an operation containing a snapshot of the current workflow state.
    AgentOperation MakeOperation(AgentOperationError error = AgentOperationError::NONE,
                                 std::string message = {});
    /// Complete the workflow with an expected exhaustion or unexpected failure.
    void SetFailed(bool expected, std::string message);
    /// Complete the workflow after a host effect is cancelled.
    void SetCancelled();
    /// Complete the workflow after the host applies the final proposal.
    void SetSucceeded();
    /// Queue a phase transition for the next operation returned to the host.
    void AddPhase(AgentPhase phase);
    /// Queue the selected intent for the next operation returned to the host.
    void AddIntent();
    /// Queue a candidate and its verification diagnostics for the host timeline.
    void AddAttempt(const VerifyResult& verify);
    /// Convert an internal verification result into its FlatBuffer object representation.
    std::unique_ptr<buffers::agent::AgentVerifyResultT> PackVerifyResult(const VerifyResult& verify) const;
    /// Statically verify a generated candidate against the borrowed catalog and safety policy.
    VerifyResult VerifyCandidate(std::string_view candidate) const;
    /// Validate and normalize a FlatBuffer completion for the expected effect type.
    EffectResult ReadCompletion(AgentEffectType type, const AgentEffectCompletion& completion) const;

    /// Interpret classifier output, defaulting ambiguous responses to SQL.
    static AgentIntent ParseIntent(std::string_view completion);
    /// Strip an optional code fence and surrounding whitespace from generated SQL.
    static std::string ExtractSql(std::string_view completion);
    /// Extract the first balanced JSON object from a visualization completion.
    static std::string ExtractJsonObject(std::string_view completion);
    /// Compile the focused native script into executable source SQL and derive its kind.
    std::string CompileTargetScript();
    /// Inject source SQL into raw Vega-Lite JSON and transcode it into DashQL VISUALIZE syntax.
    std::string TranscodeVegaLite(std::string_view raw_spec, std::string_view source_sql) const;
    /// Pretty-format a complete candidate when the formatter supports every parsed node.
    std::optional<std::string> PrettyFormatCandidate(std::string_view candidate) const;
    /// Add actionable diagnostics for Vega-Lite marks unsupported by DashQL.
    void DiagnoseVegaLiteSpec(std::string_view raw_spec, std::vector<std::string>& errors) const;

    /// Catalog borrowed for parser/analyzer verification; must outlive this session.
    Catalog& catalog_;
    /// Focused native editor target, or null when the run creates without a target.
    editor::EditorSession* target_ = nullptr;
    /// Formatting policy used for source extraction and final generated candidates.
    buffers::formatting::FormattingConfigT formatting_config_;
    /// Current externally visible phase of the active or most recent run.
    AgentPhase phase_ = AgentPhase::IDLE;
    /// Requested or model-classified artifact intent.
    AgentIntent intent_ = AgentIntent::UNKNOWN;
    /// Whether the caller supplied the intent instead of using classification.
    bool intent_overridden_ = false;
    /// Current one-based generation attempt, or zero before generation starts.
    uint32_t attempt_ = 0;
    /// Maximum number of generation and repair attempts allowed for the run.
    uint32_t max_attempts_ = 3;
    /// Monotonic source of host effect identifiers.
    uint64_t next_effect_id_ = 1;
    /// The one effect currently awaiting a host completion.
    std::optional<PendingEffect> pending_effect_;
    /// Effect emitted by the most recent coroutine suspension and not yet returned to the host.
    std::unique_ptr<buffers::agent::AgentEffectT> outgoing_effect_;
    /// Terminal operation prepared by the coroutine before reaching final suspend.
    std::optional<AgentOperation> completed_operation_;
    /// Events accumulated since the last operation was returned to the host.
    std::vector<std::unique_ptr<buffers::agent::AgentEventT>> events_;
    /// Natural-language instruction for the active run.
    std::string user_prompt_;
    /// Notebook-specific context supplied by the host.
    std::string context_;
    /// Kind of focused target reported by the host during context resolution.
    buffers::agent::AgentTargetKind target_kind_ = buffers::agent::AgentTargetKind::NONE;
    /// Core-owned decision describing whether the proposal creates or replaces a script.
    buffers::agent::AgentApplyDisposition apply_disposition_ = buffers::agent::AgentApplyDisposition::CREATE;
    /// Whether verification rejects mutating and multi-statement candidates.
    bool read_only_ = true;
    /// Latest SQL or transcoded visualization candidate.
    std::string candidate_text_;
    /// Latest raw Vega-Lite JSON returned by the model.
    std::string vegalite_spec_;
    /// Latest repairable diagnostics supplied to the next model request.
    std::vector<std::string> errors_;
};

}  // namespace dashql::agent
