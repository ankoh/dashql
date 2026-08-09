#include "dashql/shell/shell_session.h"

#include <cstring>
#include <exception>
#include <stdexcept>
#include <unordered_set>
#include <utility>

#include "dashql/analyzer/completion.h"
#include "utf8proc/utf8proc_wrapper.hpp"

namespace dashql::shell {
namespace {

constexpr uint32_t EFFECT_ENVELOPE_VERSION = 1;
constexpr size_t EFFECT_ENVELOPE_HEADER_SIZE = 16;
constexpr size_t HISTORY_LIMIT = 1000;

void AppendU32(std::string& output, uint32_t value) {
    for (size_t i = 0; i < sizeof(value); ++i) {
        output.push_back(static_cast<char>((value >> (i * 8)) & 0xff));
    }
}

void AppendU64(std::string& output, uint64_t value) {
    for (size_t i = 0; i < sizeof(value); ++i) {
        output.push_back(static_cast<char>((value >> (i * 8)) & 0xff));
    }
}

std::string NormalizeError(std::span<const uint8_t> data) {
    std::string message{reinterpret_cast<const char*>(data.data()), data.size()};
    if (message.empty()) {
        return "query failed";
    }
    return message;
}

}  // namespace

ShellSession::ShellSession(Catalog& catalog, uint32_t terminal_columns)
    : prompt_{catalog}, renderer_{terminal_columns} {}

ShellSession::~ShellSession() {
    DestroyPendingEffects();
}

void ShellSession::Resize(uint32_t terminal_columns) {
    renderer_.Resize(terminal_columns);
}

PromptSnapshot ShellSession::SetPrompt(std::string_view text) {
    if (!prompt_.SetText(text)) {
        return SnapshotPrompt(ShellStatus::kInvalidArgument, "prompt must contain valid UTF-8");
    }
    ResetHistoryCursor();
    return SnapshotPrompt();
}

PromptSnapshot ShellSession::InsertPrompt(std::string_view text) {
    if (!prompt_.Insert(text)) {
        return SnapshotPrompt(ShellStatus::kInvalidArgument, "prompt insertion must contain valid non-empty UTF-8");
    }
    ResetHistoryCursor();
    return SnapshotPrompt();
}

PromptSnapshot ShellSession::MovePromptLeft() {
    prompt_.MoveLeft();
    return SnapshotPrompt();
}

PromptSnapshot ShellSession::MovePromptRight() {
    prompt_.MoveRight();
    return SnapshotPrompt();
}

PromptSnapshot ShellSession::DeletePromptBackward() {
    prompt_.DeleteBackward();
    return SnapshotPrompt();
}

PromptSnapshot ShellSession::DeletePromptForward() {
    prompt_.DeleteForward();
    return SnapshotPrompt();
}

std::vector<CompletionCandidate> ShellSession::CompletePrompt(size_t limit) {
    prompt_.script().Analyze();
    prompt_.script().MoveCursor(prompt_.cursor_byte_offset());
    const auto completion = prompt_.script().CompleteAtCursor(limit);
    std::vector<CompletionCandidate> candidates;
    candidates.reserve(completion->GetResultCandidates().size());
    for (const auto& candidate : completion->GetResultCandidates()) {
        std::string quoted;
        const auto completion_text = candidate.completion_text_is_verbatim
                                         ? candidate.completion_text
                                         : quote_anyupper_fuzzy(candidate.completion_text, quoted);
        candidates.push_back({
            .display_text = std::string{candidate.completion_text},
            .completion_text = std::string{completion_text},
            .target_offset = candidate.target_location.offset(),
            .target_length = candidate.target_location.length(),
        });
    }
    return candidates;
}

PromptSnapshot ShellSession::ApplyCompletion(const CompletionCandidate& candidate) {
    if (!prompt_.ReplaceByteRange(candidate.target_offset, candidate.target_length, candidate.completion_text)) {
        return SnapshotPrompt(ShellStatus::kInvalidArgument, "completion target is not on prompt boundaries");
    }
    return SnapshotPrompt();
}

PromptSnapshot ShellSession::ConsumePromptInput(PromptInputKey key, std::string_view text) {
    PromptInputAction action = PromptInputAction::kNone;
    switch (key) {
        case PromptInputKey::kText:
            if (!prompt_.Insert(text)) {
                return SnapshotPrompt(ShellStatus::kInvalidArgument, "prompt input must contain valid non-empty UTF-8");
            }
            ResetHistoryCursor();
            break;
        case PromptInputKey::kEnter:
            if (PromptIsComplete()) {
                action = PromptInputAction::kSubmit;
            } else {
                prompt_.Insert("\n");
                ResetHistoryCursor();
            }
            break;
        case PromptInputKey::kForceSubmit:
            if (!prompt_.Text().empty()) action = PromptInputAction::kSubmit;
            break;
        case PromptInputKey::kTab:
            action = PromptInputAction::kComplete;
            break;
        case PromptInputKey::kBackspace:
            prompt_.DeleteBackward();
            ResetHistoryCursor();
            break;
        case PromptInputKey::kDelete:
            prompt_.DeleteForward();
            ResetHistoryCursor();
            break;
        case PromptInputKey::kLeft:
            prompt_.MoveLeft();
            break;
        case PromptInputKey::kRight:
            prompt_.MoveRight();
            break;
        case PromptInputKey::kHistoryPrevious:
            if (!history_.empty() && history_cursor_ > 0) {
                if (history_cursor_ == history_.size()) history_draft_ = prompt_.Text();
                --history_cursor_;
                prompt_.SetText(history_[history_cursor_]);
            }
            break;
        case PromptInputKey::kHistoryNext:
            if (history_cursor_ < history_.size()) {
                ++history_cursor_;
                prompt_.SetText(history_cursor_ < history_.size() ? history_[history_cursor_] : history_draft_);
            }
            break;
        case PromptInputKey::kCancel:
            prompt_.SetText("");
            ResetHistoryCursor();
            break;
    }
    auto snapshot = SnapshotPrompt();
    snapshot.action = static_cast<uint32_t>(action);
    return snapshot;
}

ShellOperation ShellSession::SubmitPrompt() {
    const auto query = prompt_.Text();
    if (query.empty()) {
        return {ShellStatus::kInvalidArgument, "query must not be empty"};
    }
    RememberPrompt(query);
    return StartQuery(query);
}

bool ShellSession::PromptIsComplete() {
    const auto text = prompt_.Text();
    if (text.find_first_not_of(" \t\r\n") == std::string::npos) return false;
    prompt_.script().Parse();
    const auto& parsed = prompt_.script().GetParsedScript();
    if (!parsed || !parsed->errors.empty() || !parsed->scanned_script->errors.empty() || parsed->statements.size() != 1) {
        return false;
    }
    auto end = text.find_last_not_of(" \t\r\n");
    return end != std::string::npos && text[end] == ';';
}

void ShellSession::ResetHistoryCursor() {
    history_cursor_ = history_.size();
    history_draft_.clear();
}

void ShellSession::RememberPrompt(std::string_view query) {
    if (history_.empty() || history_.back() != query) history_.emplace_back(query);
    while (history_.size() > HISTORY_LIMIT) history_.pop_front();
    ResetHistoryCursor();
}

std::string ShellSession::ExportHistory() const {
    std::string output;
    for (const auto& entry : history_) {
        const auto size = static_cast<uint32_t>(entry.size());
        AppendU32(output, size);
        output.append(entry);
    }
    return output;
}

ShellStatus ShellSession::ImportHistory(std::span<const uint8_t> data) {
    std::deque<std::string> history;
    size_t offset = 0;
    while (offset < data.size()) {
        if (data.size() - offset < sizeof(uint32_t)) return ShellStatus::kInvalidArgument;
        uint32_t size = 0;
        for (size_t i = 0; i < sizeof(uint32_t); ++i) size |= static_cast<uint32_t>(data[offset + i]) << (i * 8);
        offset += sizeof(uint32_t);
        if (size > data.size() - offset) return ShellStatus::kInvalidArgument;
        std::string entry{reinterpret_cast<const char*>(data.data() + offset), size};
        if (!utf8::Utf8Proc::IsValid(entry)) return ShellStatus::kInvalidArgument;
        history.push_back(std::move(entry));
        offset += size;
    }
    while (history.size() > HISTORY_LIMIT) history.pop_front();
    history_ = std::move(history);
    ResetHistoryCursor();
    return ShellStatus::kOk;
}

ShellOperation ShellSession::RenderArrowIPC(std::span<const uint8_t> data) const {
    auto rendered = renderer_.RenderIPC(data);
    if (!rendered.ok()) {
        return {ShellStatus::kArrowError, rendered.status().ToString()};
    }
    return {ShellStatus::kOk, std::move(rendered).ValueUnsafe()};
}

ShellOperation ShellSession::StartQuery(std::string_view query) {
    if (!pending_effects_.empty()) {
        return {ShellStatus::kBusy, "the shell already has an active operation"};
    }
    if (query.empty()) {
        return {ShellStatus::kInvalidArgument, "query must not be empty"};
    }

    outgoing_effect_.reset();
    completed_operation_.reset();
    auto task = ExecuteQuery(std::string{query});
    return Resume(task.Release());
}

ShellOperation ShellSession::CompleteEffect(uint64_t effect_id,
                                            EffectCompletionStatus status,
                                            std::span<const uint8_t> data) {
    auto pending = pending_effects_.find(effect_id);
    if (pending == pending_effects_.end()) {
        return {ShellStatus::kStaleEffect, "effect is no longer pending"};
    }

    outgoing_effect_.reset();
    completed_operation_.reset();
    auto effect = std::move(pending->second);
    pending_effects_.erase(pending);
    effect.state->completion = EffectCompletion{status, std::vector<uint8_t>{data.begin(), data.end()}};
    return Resume(effect.coroutine);
}

ShellOperation ShellSession::CancelEffect(uint64_t effect_id) {
    return CompleteEffect(effect_id, EffectCompletionStatus::kCancelled, {});
}

ShellSession::EffectAwaiter::EffectAwaiter(ShellSession& session, EffectType type, std::string payload)
    : session_{session}, type_{type}, payload_{std::move(payload)}, state_{std::make_shared<EffectState>()} {}

void ShellSession::EffectAwaiter::await_suspend(Task::Handle coroutine) {
    session_.SuspendEffect(type_, std::move(payload_), coroutine, state_);
}

EffectCompletion ShellSession::EffectAwaiter::await_resume() {
    if (!state_->completion.has_value()) {
        throw std::logic_error{"effect resumed without a completion"};
    }
    return std::move(*state_->completion);
}

Task ShellSession::ExecuteQuery(std::string query) {
    auto completion = co_await EffectAwaiter{*this, EffectType::kExecuteQuery, std::move(query)};
    switch (completion.status) {
        case EffectCompletionStatus::kSuccess:
            completed_operation_ = RenderArrowIPC(completion.data);
            break;
        case EffectCompletionStatus::kError:
            completed_operation_ = ShellOperation{ShellStatus::kOk, NormalizeError(completion.data)};
            break;
        case EffectCompletionStatus::kCancelled:
            completed_operation_ = ShellOperation{ShellStatus::kOk, "Cancelled"};
            break;
    }
}

void ShellSession::SuspendEffect(EffectType type,
                                 std::string payload,
                                 Task::Handle coroutine,
                                 std::shared_ptr<EffectState> state) {
    if (outgoing_effect_.has_value()) {
        throw std::logic_error{"invalid concurrent shell effect"};
    }
    const auto effect_id = next_effect_id_++;
    auto [_, inserted] = pending_effects_.emplace(effect_id, PendingEffect{type, coroutine, std::move(state)});
    if (!inserted) {
        throw std::logic_error{"invalid concurrent shell effect"};
    }
    outgoing_effect_ = OutgoingEffect{effect_id, type, std::move(payload)};
}

ShellOperation ShellSession::Resume(Task::Handle coroutine) {
    if (!coroutine || coroutine.done()) {
        if (coroutine) {
            coroutine.destroy();
        }
        return {ShellStatus::kInternalError, "invalid shell coroutine"};
    }
    coroutine.resume();
    return CollectOperation(coroutine);
}

ShellOperation ShellSession::CollectOperation(Task::Handle coroutine) {
    if (!coroutine.done()) {
        if (!outgoing_effect_.has_value()) {
            coroutine.destroy();
            return {ShellStatus::kInternalError, "shell coroutine suspended without an effect"};
        }
        return EncodeOutgoingEffect();
    }

    auto exception = coroutine.promise().exception;
    coroutine.destroy();
    if (exception) {
        try {
            std::rethrow_exception(exception);
        } catch (const std::exception& error) {
            return {ShellStatus::kInternalError, error.what()};
        } catch (...) {
            return {ShellStatus::kInternalError, "unknown shell coroutine error"};
        }
    }
    if (!completed_operation_.has_value()) {
        return {ShellStatus::kInternalError, "shell coroutine completed without output"};
    }
    return std::move(*completed_operation_);
}

ShellOperation ShellSession::EncodeOutgoingEffect() {
    auto effect = std::move(*outgoing_effect_);
    outgoing_effect_.reset();

    std::string encoded;
    encoded.reserve(EFFECT_ENVELOPE_HEADER_SIZE + effect.payload.size());
    AppendU32(encoded, EFFECT_ENVELOPE_VERSION);
    AppendU32(encoded, static_cast<uint32_t>(effect.type));
    AppendU64(encoded, effect.id);
    encoded.append(effect.payload);
    return {ShellStatus::kPending, std::move(encoded)};
}

PromptSnapshot ShellSession::SnapshotPrompt(ShellStatus status, std::string message) {
    return {
        .status = status,
        .revision = prompt_.revision(),
        .cursor_byte_offset = static_cast<uint32_t>(prompt_.cursor_byte_offset()),
        .text = prompt_.Text(),
        .message = std::move(message),
        .action = static_cast<uint32_t>(PromptInputAction::kNone),
    };
}

void ShellSession::DestroyPendingEffects() {
    std::unordered_set<void*> destroyed;
    for (auto& [_, effect] : pending_effects_) {
        if (effect.coroutine && destroyed.insert(effect.coroutine.address()).second) {
            effect.coroutine.destroy();
        }
    }
    pending_effects_.clear();
    outgoing_effect_.reset();
    completed_operation_.reset();
}

}  // namespace dashql::shell
