#include "dashql/shell/shell_session.h"

#include <algorithm>
#include <cstring>
#include <exception>
#include <stdexcept>
#include <unordered_set>
#include <utility>

#include "dashql/analyzer/completion.h"
#include "dashql/shell/vt100.h"
#include "utf8proc/utf8proc_wrapper.hpp"

namespace dashql::shell {
namespace {

using ScannerTokenType = buffers::parser::ScannerTokenType;

constexpr uint32_t EFFECT_ENVELOPE_VERSION = 1;
constexpr size_t EFFECT_ENVELOPE_HEADER_SIZE = 16;
constexpr size_t HISTORY_LIMIT = 1000;

std::string_view TokenStyle(ScannerTokenType type) {
    switch (type) {
        case ScannerTokenType::KEYWORD:
            return vt100::kBoldForegroundPink;
        case ScannerTokenType::KEYWORD_VIS:
            return vt100::kItalicForegroundTeal;
        case ScannerTokenType::LITERAL_INTEGER:
        case ScannerTokenType::LITERAL_FLOAT:
        case ScannerTokenType::LITERAL_BINARY:
        case ScannerTokenType::LITERAL_HEX:
        case ScannerTokenType::LITERAL_BOOLEAN:
            return vt100::kForegroundPurple;
        case ScannerTokenType::LITERAL_STRING:
            return vt100::kForegroundCoral;
        case ScannerTokenType::OPERATOR:
            return vt100::kForegroundPink;
        case ScannerTokenType::IDENTIFIER:
            return vt100::kForegroundTeal;
        case ScannerTokenType::COMMENT:
            return vt100::kForegroundGray;
        default:
            return {};
    }
}

void AppendCursorMove(std::string& output, size_t count, std::string_view command) {
    if (count == 0) return;
    output.append(vt100::kControlSequenceIntroducer);
    output.append(std::to_string(count));
    output.append(command);
}

size_t CountLines(std::string_view text) {
    return 1 + static_cast<size_t>(std::count(text.begin(), text.end(), '\n'));
}

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

ShellOperation ShellSession::OpenTerminal(std::string_view prompt, bool welcome) {
    terminal_action_ = PromptInputAction::kNone;
    if (!utf8::Utf8Proc::IsValid(prompt)) {
        return {ShellStatus::kInvalidArgument, "terminal prompt must contain valid UTF-8"};
    }
    if (prompt.size() > terminal_prompt_storage_.size()) {
        return {ShellStatus::kInvalidArgument, "terminal prompt is too long"};
    }
    std::copy(prompt.begin(), prompt.end(), terminal_prompt_storage_.begin());
    terminal_prompt_length_ = prompt.size();
    terminal_prompt_rows_ = 1;
    std::string output;
    if (welcome) {
        output.append(vt100::kBold);
        output.append("DashQL Shell");
        output.append(vt100::kResetAttributes);
        output.append(vt100::kNewLine);
        output.append("Terminate SQL with \";\". Tab completes. Ctrl+C cancels. Escape returns to the notebook.");
        output.append(vt100::kNewLine);
    }
    output.append(RenderTerminalPrompt());
    return {ShellStatus::kOk, std::move(output)};
}

ShellOperation ShellSession::ConsumeTerminalInput(PromptInputKey key, std::string_view text) {
    terminal_action_ = PromptInputAction::kNone;
    auto snapshot = ConsumePromptInput(key, text);
    if (snapshot.status != ShellStatus::kOk) {
        return {snapshot.status, std::move(snapshot.message)};
    }
    const auto action = static_cast<PromptInputAction>(snapshot.action);
    if (action == PromptInputAction::kSubmit) {
        terminal_action_ = action;
        terminal_prompt_rows_ = 1;
        return {ShellStatus::kOk, std::string{vt100::kNewLine}};
    }
    if (action == PromptInputAction::kComplete) {
        auto candidates = CompletePrompt(50);
        if (candidates.size() == 1) {
            snapshot = ApplyCompletion(candidates.front());
            if (snapshot.status != ShellStatus::kOk) {
                return {snapshot.status, std::move(snapshot.message)};
            }
            return {ShellStatus::kOk, RenderTerminalPrompt()};
        }
        if (candidates.size() > 1) {
            return {ShellStatus::kOk, RenderTerminalCompletions(candidates)};
        }
    }
    if (key == PromptInputKey::kCancel) {
        terminal_prompt_rows_ = 1;
        std::string output{"^C"};
        output.append(vt100::kNewLine);
        output.append(RenderTerminalPrompt());
        return {ShellStatus::kOk, std::move(output)};
    }
    return {ShellStatus::kOk, RenderTerminalPrompt()};
}

ShellOperation ShellSession::ConsumeTerminalData(std::string_view data) {
    terminal_action_ = PromptInputAction::kNone;
    if (data == vt100::kEscape) {
        terminal_action_ = PromptInputAction::kExit;
        return {ShellStatus::kOk, {}};
    }
    if (data == vt100::kCtrlUnderscore) return ConsumeTerminalInput(PromptInputKey::kForceSubmit);
    if (data == vt100::kCtrlC) return ConsumeTerminalInput(PromptInputKey::kCancel);
    if (data == vt100::kCarriageReturn) return ConsumeTerminalInput(PromptInputKey::kEnter);
    if (data == vt100::kTab) return ConsumeTerminalInput(PromptInputKey::kTab);
    if (data == vt100::kBackspace) return ConsumeTerminalInput(PromptInputKey::kBackspace);
    if (data == vt100::kDeleteKey) return ConsumeTerminalInput(PromptInputKey::kDelete);
    if (data == vt100::kArrowLeftKey) return ConsumeTerminalInput(PromptInputKey::kLeft);
    if (data == vt100::kArrowRightKey) return ConsumeTerminalInput(PromptInputKey::kRight);
    if (data == vt100::kArrowUpKey) return ConsumeTerminalInput(PromptInputKey::kHistoryPrevious);
    if (data == vt100::kArrowDownKey) return ConsumeTerminalInput(PromptInputKey::kHistoryNext);
    if (data.starts_with(vt100::kEscape)) return {ShellStatus::kOk, {}};
    return ConsumeTerminalInput(PromptInputKey::kText, data);
}

ShellOperation ShellSession::FinishTerminalQuery(std::string_view output, bool error) {
    terminal_action_ = PromptInputAction::kNone;
    std::string rendered;
    if (error) rendered.append(vt100::kForegroundRed);
    rendered.append(output);
    if (error) rendered.append(vt100::kResetAttributes);
    rendered.append(vt100::kNewLine);
    prompt_.SetText("");
    terminal_prompt_rows_ = 1;
    rendered.append(RenderTerminalPrompt());
    return {ShellStatus::kOk, std::move(rendered)};
}

ShellOperation ShellSession::RenderTerminalStatus(std::string_view message) {
    terminal_action_ = PromptInputAction::kNone;
    std::string output{vt100::kNewLine};
    output.append(vt100::kForegroundBrightBlack);
    output.append(message);
    output.append(vt100::kResetAttributes);
    output.append(vt100::kNewLine);
    terminal_prompt_rows_ = 1;
    output.append(RenderTerminalPrompt());
    return {ShellStatus::kOk, std::move(output)};
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

std::string ShellSession::RenderTerminalPrompt() {
    const auto text = prompt_.Text();
    const auto terminal_prompt = terminal_prompt_length_ == 0
                                     ? std::string_view{"dashql> "}
                                     : std::string_view{terminal_prompt_storage_.data(), terminal_prompt_length_};
    prompt_.script().Parse();
    auto packed = prompt_.script().GetParsedScript()->PackTokens();

    std::string highlighted;
    highlighted.reserve(text.size() + packed->token_offsets.size() * 16);
    size_t offset = 0;
    for (size_t i = 0; i < packed->token_offsets.size(); ++i) {
        const auto begin = static_cast<size_t>(packed->token_offsets[i]);
        const auto end = begin + packed->token_lengths[i];
        if (begin > offset) highlighted.append(text.substr(offset, begin - offset));
        const auto style = TokenStyle(packed->token_types[i]);
        if (!style.empty()) highlighted.append(style);
        highlighted.append(text.substr(begin, end - begin));
        if (!style.empty()) highlighted.append(vt100::kResetAttributes);
        offset = end;
    }
    highlighted.append(text.substr(offset));

    std::string output;
    for (size_t i = 0; i < terminal_prompt_rows_; ++i) {
        output.append(vt100::kCarriageReturn);
        output.append(vt100::kEraseEntireLine);
        if (i + 1 < terminal_prompt_rows_) output.append(vt100::kCursorUpOne);
    }

    size_t line_begin = 0;
    size_t line = 0;
    while (line_begin <= highlighted.size()) {
        const auto line_end = highlighted.find('\n', line_begin);
        output.append(line == 0 ? terminal_prompt : terminal_continuation_);
        output.append(highlighted.substr(line_begin, line_end - line_begin));
        if (line_end == std::string::npos) break;
        output.append(vt100::kNewLine);
        line_begin = line_end + 1;
        ++line;
    }
    terminal_prompt_rows_ = CountLines(text);

    const auto cursor = prompt_.cursor_byte_offset();
    const auto cursor_line = static_cast<size_t>(std::count(text.begin(), text.begin() + cursor, '\n'));
    const auto cursor_line_begin = cursor_line == 0 ? 0 : text.rfind('\n', cursor - 1) + 1;
    const auto cursor_prefix = cursor_line == 0 ? terminal_prompt : terminal_continuation_;
    const auto cursor_column = utf8::Utf8Proc::RenderWidth(std::string{cursor_prefix}) +
                               utf8::Utf8Proc::RenderWidth(text.substr(cursor_line_begin, cursor - cursor_line_begin));
    const auto rows_up = terminal_prompt_rows_ - cursor_line - 1;
    output.append(vt100::kCarriageReturn);
    AppendCursorMove(output, rows_up, vt100::kCursorUpCommand);
    AppendCursorMove(output, cursor_column, vt100::kCursorForwardCommand);
    return output;
}

std::string ShellSession::RenderTerminalCompletions(const std::vector<CompletionCandidate>& candidates) {
    size_t width = 1;
    for (const auto& candidate : candidates) {
        width = std::max(width, utf8::Utf8Proc::RenderWidth(candidate.display_text));
    }
    width += 2;
    const auto columns = std::max<size_t>(1, renderer_.terminal_columns() / width);
    std::string output{vt100::kNewLine};
    for (size_t i = 0; i < candidates.size(); i += columns) {
        for (size_t j = i; j < std::min(i + columns, candidates.size()); ++j) {
            const auto& text = candidates[j].display_text;
            output.append(text);
            output.append(width - utf8::Utf8Proc::RenderWidth(text), ' ');
        }
        output.append(vt100::kNewLine);
    }
    terminal_prompt_rows_ = 1;
    output.append(RenderTerminalPrompt());
    return output;
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
