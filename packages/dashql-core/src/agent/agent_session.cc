#include "dashql/agent/agent_session.h"

#include <algorithm>
#include <cctype>
#include <stdexcept>

#include "dashql/script.h"

namespace dashql::agent {
namespace {
using namespace buffers::agent;

bool IsTerminal(AgentPhase phase) {
    return phase == AgentPhase::SUCCEEDED || phase == AgentPhase::FAILED || phase == AgentPhase::CANCELLED;
}

std::string Trim(std::string_view text) {
    size_t begin = 0;
    while (begin < text.size() && std::isspace(static_cast<unsigned char>(text[begin]))) ++begin;
    size_t end = text.size();
    while (end > begin && std::isspace(static_cast<unsigned char>(text[end - 1]))) --end;
    return std::string{text.substr(begin, end - begin)};
}

std::optional<std::string_view> ExtractFence(std::string_view text) {
    auto begin = text.find("```");
    if (begin == std::string_view::npos) return std::nullopt;
    begin += 3;
    auto end = text.find("```", begin);
    if (end == std::string_view::npos) return std::nullopt;
    auto newline = text.find('\n', begin);
    if (newline != std::string_view::npos && newline < end) begin = newline + 1;
    return text.substr(begin, end - begin);
}

void AppendUnique(std::vector<std::string>& target, const std::vector<std::string>& source) {
    for (const auto& value : source) {
        if (std::find(target.begin(), target.end(), value) == target.end()) target.push_back(value);
    }
}

}  // namespace

AgentSession::~AgentSession() {
    if (pending_effect_) pending_effect_->coroutine.destroy();
}

AgentSession::AgentOperation AgentSession::Start(const AgentStartRequest& request) {
    if (pending_effect_ || (phase_ != AgentPhase::IDLE && !IsTerminal(phase_))) {
        return MakeOperation(AgentStatus::BUSY, "the agent already has an active operation");
    }
    if (request.user_prompt.empty()) return MakeOperation(AgentStatus::INVALID_ARGUMENT, "user prompt must not be empty");
    if (request.max_attempts == 0) return MakeOperation(AgentStatus::INVALID_ARGUMENT, "max attempts must be greater than zero");
    if (request.intent_override != AgentIntent::UNKNOWN && request.intent_override != AgentIntent::SQL &&
        request.intent_override != AgentIntent::VISUALIZE) {
        return MakeOperation(AgentStatus::INVALID_ARGUMENT, "invalid intent override");
    }

    phase_ = AgentPhase::IDLE;
    intent_ = request.intent_override;
    intent_overridden_ = intent_ != AgentIntent::UNKNOWN;
    attempt_ = 0;
    max_attempts_ = request.max_attempts;
    read_only_ = request.read_only;
    user_prompt_ = request.user_prompt;
    context_.clear();
    target_kind_ = AgentTargetKind::NONE;
    target_name_.clear();
    apply_disposition_ = AgentApplyDisposition::CREATE;
    candidate_text_.clear();
    vegalite_spec_.clear();
    errors_.clear();
    events_.clear();
    outgoing_effect_.reset();
    completed_operation_.reset();

    auto task = Run();
    return Resume(task.Release());
}

AgentSession::AgentOperation AgentSession::CompleteEffect(const AgentEffectCompletion& completion) {
    if (!pending_effect_ || pending_effect_->id != completion.effect_id) {
        return MakeOperation(AgentStatus::STALE_EFFECT, "effect is no longer pending");
    }
    if (completion.status != AgentEffectCompletionStatus::SUCCESS &&
        completion.status != AgentEffectCompletionStatus::ERROR &&
        completion.status != AgentEffectCompletionStatus::CANCELLED) {
        return MakeOperation(AgentStatus::INVALID_ARGUMENT, "invalid effect completion status");
    }

    EffectResult result;
    try {
        result = ReadCompletion(pending_effect_->type, completion);
    } catch (const std::invalid_argument& error) {
        return MakeOperation(AgentStatus::INVALID_ARGUMENT, error.what());
    }
    auto pending = std::move(*pending_effect_);
    pending_effect_.reset();
    outgoing_effect_.reset();
    completed_operation_.reset();
    pending.state->result = std::move(result);
    return Resume(pending.coroutine);
}

AgentSession::AgentOperation AgentSession::Cancel() {
    if (!pending_effect_) return MakeOperation(AgentStatus::OK);
    AgentEffectCompletion completion;
    completion.effect_id = pending_effect_->id;
    completion.status = AgentEffectCompletionStatus::CANCELLED;
    return CompleteEffect(completion);
}

AgentSession::Task AgentSession::Run() {
    if (intent_ == AgentIntent::UNKNOWN) {
        phase_ = AgentPhase::CLASSIFYING;
        AddPhase(phase_);
        auto classified = co_await AwaitModel(AgentModelRequestKind::CLASSIFY);
        if (classified.status == AgentEffectCompletionStatus::CANCELLED) {
            SetCancelled();
            co_return;
        }
        if (classified.status == AgentEffectCompletionStatus::ERROR) {
            SetFailed(false, classified.value);
            co_return;
        }
        intent_ = ParseIntent(classified.value);
        AddIntent();
    } else {
        AddIntent();
    }

    auto context = co_await AwaitContext();
    if (context.status == AgentEffectCompletionStatus::CANCELLED) {
        SetCancelled();
        co_return;
    }
    if (context.status == AgentEffectCompletionStatus::ERROR) {
        SetFailed(false, context.value);
        co_return;
    }
    context_ = std::move(context.value);
    target_kind_ = context.target_kind;
    target_name_ = std::move(context.target_name);
    apply_disposition_ =
        (intent_ == AgentIntent::SQL && target_kind_ != AgentTargetKind::NONE) ||
                (intent_ == AgentIntent::VISUALIZE && target_kind_ == AgentTargetKind::VISUALIZATION)
            ? AgentApplyDisposition::REPLACE
            : AgentApplyDisposition::CREATE;

    VerifyResult final_verify;
    bool valid = false;
    for (attempt_ = 1; attempt_ <= max_attempts_; ++attempt_) {
        phase_ = attempt_ == 1 ? AgentPhase::GENERATING : AgentPhase::REPAIRING;
        AddPhase(phase_);
        auto model = co_await AwaitModel(attempt_ == 1 ? AgentModelRequestKind::GENERATE
                                                       : AgentModelRequestKind::REPAIR);
        if (model.status == AgentEffectCompletionStatus::CANCELLED) {
            SetCancelled();
            co_return;
        }
        if (model.status == AgentEffectCompletionStatus::ERROR) {
            SetFailed(false, model.value);
            co_return;
        }

        errors_.clear();
        final_verify = {};
        if (intent_ == AgentIntent::VISUALIZE) {
            vegalite_spec_ = ExtractJsonObject(model.value);
            candidate_text_ = vegalite_spec_;
            auto transcode = co_await AwaitTranscode();
            if (transcode.status == AgentEffectCompletionStatus::CANCELLED) {
                SetCancelled();
                co_return;
            }
            if (transcode.status == AgentEffectCompletionStatus::ERROR) {
                SetFailed(false, transcode.value);
                co_return;
            }
            candidate_text_ = std::move(transcode.value);
            errors_ = std::move(transcode.errors);
            if (candidate_text_ != vegalite_spec_ && !Trim(candidate_text_).empty()) {
                final_verify = VerifyCandidate(candidate_text_);
            }
        } else {
            candidate_text_ = ExtractSql(model.value);
            if (!Trim(candidate_text_).empty()) final_verify = VerifyCandidate(candidate_text_);
        }
        if (Trim(candidate_text_).empty()) errors_.push_back("The model returned an empty result.");
        AppendUnique(errors_, final_verify.parser_errors);
        AppendUnique(errors_, final_verify.analyzer_errors);
        if (errors_.empty() && intent_ == AgentIntent::VISUALIZE && final_verify.visualization_specs == 0) {
            errors_.push_back("The statement did not resolve into a visualization. Check the source and channels.");
        }
        phase_ = AgentPhase::VERIFYING;
        AddPhase(phase_);
        AddAttempt(final_verify);
        if (errors_.empty()) {
            valid = true;
            break;
        }
    }

    if (!valid) {
        auto count = std::min(attempt_, max_attempts_);
        attempt_ = count;
        std::string message = "Gave up after " + std::to_string(max_attempts_) + " attempts";
        if (!errors_.empty()) message += ": " + errors_.front();
        SetFailed(true, std::move(message));
        co_return;
    }

    phase_ = AgentPhase::APPLYING;
    AddPhase(phase_);
    auto apply = co_await AwaitApply(final_verify);
    if (apply.status == AgentEffectCompletionStatus::CANCELLED) {
        SetCancelled();
    } else if (apply.status == AgentEffectCompletionStatus::ERROR) {
        SetFailed(false, apply.value);
    } else if (!apply.applied) {
        SetFailed(false, "the proposal was not applied");
    } else {
        SetSucceeded();
    }
}

AgentSession::EffectAwaiter AgentSession::AwaitModel(AgentModelRequestKind kind) {
    auto effect = std::make_unique<AgentEffectT>();
    effect->type = AgentEffectType::MODEL_REQUEST;
    effect->model_request = std::make_unique<AgentModelRequestEffectT>();
    effect->model_request->kind = kind;
    effect->model_request->intent = intent_;
    effect->model_request->user_prompt = user_prompt_;
    effect->model_request->context = context_;
    effect->model_request->previous_candidate = candidate_text_;
    effect->model_request->errors = errors_;
    effect->model_request->editing_chart = target_kind_ == AgentTargetKind::VISUALIZATION;
    return EffectAwaiter{*this, std::move(effect)};
}

AgentSession::EffectAwaiter AgentSession::AwaitContext() {
    auto effect = std::make_unique<AgentEffectT>();
    effect->type = AgentEffectType::RESOLVE_CONTEXT;
    effect->resolve_context = std::make_unique<AgentResolveContextEffectT>();
    effect->resolve_context->intent = intent_;
    return EffectAwaiter{*this, std::move(effect)};
}

AgentSession::EffectAwaiter AgentSession::AwaitTranscode() {
    auto effect = std::make_unique<AgentEffectT>();
    effect->type = AgentEffectType::TRANSCODE_VEGALITE;
    effect->transcode_vegalite = std::make_unique<AgentTranscodeVegaLiteEffectT>();
    effect->transcode_vegalite->raw_spec_json = vegalite_spec_;
    return EffectAwaiter{*this, std::move(effect)};
}

AgentSession::EffectAwaiter AgentSession::AwaitApply(const VerifyResult& verify) {
    auto effect = std::make_unique<AgentEffectT>();
    effect->type = AgentEffectType::APPLY_PROPOSAL;
    effect->apply_proposal = std::make_unique<AgentApplyProposalEffectT>();
    effect->apply_proposal->proposal = std::make_unique<AgentProposalT>();
    effect->apply_proposal->proposal->intent = intent_;
    effect->apply_proposal->proposal->candidate_text = candidate_text_;
    effect->apply_proposal->proposal->verify_result = PackVerifyResult(verify);
    effect->apply_proposal->proposal->disposition = apply_disposition_;
    effect->apply_proposal->proposal->target_name =
        apply_disposition_ == AgentApplyDisposition::REPLACE ? target_name_ : "";
    return EffectAwaiter{*this, std::move(effect)};
}

void AgentSession::EffectAwaiter::await_suspend(Task::Handle coroutine) {
    session_.SuspendEffect(std::move(effect_), coroutine, state_);
}

AgentSession::EffectResult AgentSession::EffectAwaiter::await_resume() {
    if (!state_->result) throw std::logic_error{"agent effect resumed without completion"};
    return std::move(*state_->result);
}

void AgentSession::SuspendEffect(std::unique_ptr<AgentEffectT> effect, Task::Handle coroutine,
                                 std::shared_ptr<EffectState> state) {
    if (pending_effect_ || outgoing_effect_) throw std::logic_error{"invalid concurrent agent effect"};
    effect->id = next_effect_id_++;
    pending_effect_ = PendingEffect{effect->id, effect->type, coroutine, std::move(state)};
    outgoing_effect_ = std::move(effect);
}

AgentSession::AgentOperation AgentSession::Resume(Task::Handle coroutine) {
    coroutine.resume();
    return CollectOperation(coroutine);
}

AgentSession::AgentOperation AgentSession::CollectOperation(Task::Handle coroutine) {
    if (!coroutine.done()) {
        if (!outgoing_effect_) {
            if (pending_effect_ && pending_effect_->coroutine == coroutine) pending_effect_.reset();
            coroutine.destroy();
            return MakeOperation(AgentStatus::INTERNAL_ERROR, "agent coroutine suspended without an effect");
        }
        auto operation = MakeOperation(AgentStatus::PENDING);
        operation.effect = std::move(outgoing_effect_);
        operation.events = std::move(events_);
        events_.clear();
        return operation;
    }
    pending_effect_.reset();
    outgoing_effect_.reset();
    auto exception = coroutine.promise().exception;
    coroutine.destroy();
    if (exception) {
        try {
            std::rethrow_exception(exception);
        } catch (const std::exception& error) {
            return MakeOperation(AgentStatus::INTERNAL_ERROR, error.what());
        }
    }
    if (!completed_operation_) return MakeOperation(AgentStatus::INTERNAL_ERROR, "agent coroutine completed without output");
    auto out = std::move(*completed_operation_);
    completed_operation_.reset();
    return out;
}

AgentSession::AgentOperation AgentSession::MakeOperation(AgentStatus status, std::string message) {
    AgentOperation operation;
    operation.status = status;
    operation.status_message = std::move(message);
    operation.snapshot = std::make_unique<AgentSnapshotT>();
    operation.snapshot->phase = phase_;
    operation.snapshot->intent = intent_;
    operation.snapshot->attempt = std::min(attempt_, max_attempts_);
    operation.snapshot->max_attempts = max_attempts_;
    operation.snapshot->candidate_text = candidate_text_;
    operation.snapshot->vegalite_spec = vegalite_spec_;
    operation.snapshot->errors = errors_;
    return operation;
}

void AgentSession::SetFailed(bool expected, std::string message) {
    phase_ = AgentPhase::FAILED;
    auto event = std::make_unique<AgentEventT>();
    event->type = AgentEventType::FAILED;
    event->phase = phase_;
    event->intent = intent_;
    event->attempt = std::min(attempt_, max_attempts_);
    event->expected_failure = expected;
    event->message = std::move(message);
    events_.push_back(std::move(event));
    completed_operation_ = MakeOperation(AgentStatus::OK);
    completed_operation_->events = std::move(events_);
}

void AgentSession::SetCancelled() {
    phase_ = AgentPhase::CANCELLED;
    auto event = std::make_unique<AgentEventT>();
    event->type = AgentEventType::CANCELLED;
    event->phase = phase_;
    event->intent = intent_;
    event->attempt = std::min(attempt_, max_attempts_);
    events_.push_back(std::move(event));
    completed_operation_ = MakeOperation(AgentStatus::OK);
    completed_operation_->events = std::move(events_);
}

void AgentSession::SetSucceeded() {
    phase_ = AgentPhase::SUCCEEDED;
    auto event = std::make_unique<AgentEventT>();
    event->type = AgentEventType::SUCCEEDED;
    event->phase = phase_;
    event->intent = intent_;
    event->attempt = attempt_;
    event->message = apply_disposition_ == AgentApplyDisposition::REPLACE
                         ? "updated the focused target"
                         : "created a new entry";
    events_.push_back(std::move(event));
    completed_operation_ = MakeOperation(AgentStatus::OK);
    completed_operation_->events = std::move(events_);
}

void AgentSession::AddPhase(AgentPhase phase) {
    auto event = std::make_unique<AgentEventT>();
    event->type = AgentEventType::PHASE_CHANGED;
    event->phase = phase;
    event->intent = intent_;
    event->attempt = attempt_;
    events_.push_back(std::move(event));
}

void AgentSession::AddIntent() {
    auto event = std::make_unique<AgentEventT>();
    event->type = AgentEventType::INTENT_SELECTED;
    event->intent = intent_;
    event->intent_overridden = intent_overridden_;
    events_.push_back(std::move(event));
}

void AgentSession::AddAttempt(const VerifyResult& verify) {
    auto event = std::make_unique<AgentEventT>();
    event->type = AgentEventType::ATTEMPT_FINISHED;
    event->phase = AgentPhase::VERIFYING;
    event->intent = intent_;
    event->attempt = attempt_;
    event->attempt_result = std::make_unique<AgentAttemptResultT>();
    event->attempt_result->attempt = attempt_;
    event->attempt_result->candidate_text = candidate_text_;
    event->attempt_result->vegalite_spec = vegalite_spec_;
    event->attempt_result->errors = errors_;
    event->attempt_result->verify_result = PackVerifyResult(verify);
    events_.push_back(std::move(event));
}

std::unique_ptr<AgentVerifyResultT> AgentSession::PackVerifyResult(const VerifyResult& verify) const {
    auto out = std::make_unique<AgentVerifyResultT>();
    out->parser_errors = verify.parser_errors;
    out->analyzer_errors = verify.analyzer_errors;
    out->visualization_specs = verify.visualization_specs;
    return out;
}

AgentSession::EffectResult AgentSession::ReadCompletion(AgentEffectType type,
                                                        const AgentEffectCompletion& completion) const {
    EffectResult out;
    out.status = completion.status;
    if (completion.status == AgentEffectCompletionStatus::ERROR) {
        out.value = completion.error.empty() ? "agent effect failed" : completion.error;
        return out;
    }
    if (completion.status == AgentEffectCompletionStatus::CANCELLED) return out;
    switch (type) {
        case AgentEffectType::MODEL_REQUEST:
            if (!completion.model) throw std::invalid_argument{"model result is missing"};
            out.value = completion.model->text;
            break;
        case AgentEffectType::RESOLVE_CONTEXT:
            if (!completion.context) throw std::invalid_argument{"context result is missing"};
            out.value = completion.context->context;
            out.target_kind = completion.context->target_kind;
            out.target_name = completion.context->target_name;
            break;
        case AgentEffectType::TRANSCODE_VEGALITE:
            if (!completion.transcode_vegalite) throw std::invalid_argument{"Vega-Lite transcode result is missing"};
            out.value = completion.transcode_vegalite->candidate_text;
            out.errors = completion.transcode_vegalite->errors;
            break;
        case AgentEffectType::APPLY_PROPOSAL:
            if (!completion.apply) throw std::invalid_argument{"apply result is missing"};
            out.applied = completion.apply->applied;
            break;
        default:
            throw std::invalid_argument{"unknown agent effect"};
    }
    return out;
}

AgentSession::VerifyResult AgentSession::VerifyCandidate(std::string_view candidate) const {
    VerifyResult result;
    try {
        Script script{catalog_};
        script.InsertTextAt(0, candidate);
        script.Analyze();
        const auto& parsed = script.GetParsedScript();
        const auto& analyzed = script.GetAnalyzedScript();
        if (parsed) {
            if (parsed->scanned_script) {
                for (const auto& [_, message] : parsed->scanned_script->errors) result.parser_errors.push_back(message);
            }
            for (const auto& error : parsed->errors) result.parser_errors.push_back(error.message);
            if (result.parser_errors.empty() && read_only_) {
                if (parsed->statements.size() != 1) {
                    result.parser_errors.push_back("The generated SQL must contain exactly one statement.");
                } else {
                    const auto type = parsed->statements.front().type;
                    if (type != buffers::parser::StatementType::SELECT &&
                        type != buffers::parser::StatementType::VIS_VISUALISE) {
                        result.parser_errors.push_back("The generated SQL must be a read-only SELECT statement.");
                    }
                }
            }
        }
        if (analyzed) {
            for (const auto& error : analyzed->errors) {
                if (error.severity != buffers::analyzer::AnalyzerErrorSeverity::WARNING) {
                    result.analyzer_errors.push_back(error.message);
                }
            }
            result.visualization_specs = static_cast<uint32_t>(analyzed->visualization_specs.GetSize());
        }
    } catch (const std::exception& error) {
        result.parser_errors.emplace_back(error.what());
    }
    return result;
}

AgentSession::AgentIntent AgentSession::ParseIntent(std::string_view completion) {
    std::string lower{completion};
    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return std::tolower(c); });
    const bool visual = lower.find("visualize") != std::string::npos || lower.find("visualise") != std::string::npos ||
                        lower.find("chart") != std::string::npos || lower.find("plot") != std::string::npos ||
                        lower.find("graph") != std::string::npos;
    const bool sql = lower.find("sql") != std::string::npos || lower.find("query") != std::string::npos;
    return visual && !sql ? AgentIntent::VISUALIZE : AgentIntent::SQL;
}

std::string AgentSession::ExtractSql(std::string_view completion) {
    if (auto fenced = ExtractFence(completion)) return Trim(*fenced);
    return Trim(completion);
}

std::string AgentSession::ExtractJsonObject(std::string_view completion) {
    auto text = ExtractFence(completion).value_or(completion);
    auto start = text.find('{');
    if (start == std::string_view::npos) return Trim(text);
    size_t depth = 0;
    bool in_string = false;
    bool escaped = false;
    for (size_t i = start; i < text.size(); ++i) {
        const char ch = text[i];
        if (in_string) {
            if (escaped) escaped = false;
            else if (ch == '\\') escaped = true;
            else if (ch == '"') in_string = false;
        } else if (ch == '"') in_string = true;
        else if (ch == '{') ++depth;
        else if (ch == '}' && --depth == 0) return std::string{text.substr(start, i - start + 1)};
    }
    return std::string{text.substr(start)};
}

}  // namespace dashql::agent
