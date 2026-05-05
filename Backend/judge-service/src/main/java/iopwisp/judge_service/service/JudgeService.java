package iopwisp.judge_service.service;

import iopwisp.judge_service.dto.JudgeRequest;
import iopwisp.judge_service.executor.CodeExecutor;
import iopwisp.judge_service.model.JudgeResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
@Slf4j
public class JudgeService {

    private final CodeExecutor codeExecutor;
    private final KafkaTemplate<String, JudgeResult> kafkaTemplate;

    @KafkaListener(topics = "submission.created", groupId = "judge-service-group")
    public void judgeSubmission(JudgeRequest request) {
        log.info("Received submission {} for judging", request.getSubmissionId());

        JudgeResult result = new JudgeResult();
        result.setSubmissionId(request.getSubmissionId());
        result.setUserId(request.getUserId());
        result.setTaskId(request.getTaskId());

        try {
            CodeExecutor.CompilationResult compilationResult =
                    codeExecutor.compile(request.getSourceCode(), request.getLanguage());

            if (!compilationResult.isSuccess()) {
                result.setStatus(JudgeResult.Status.FAILED);
                result.setVerdict("Compilation Error");
                result.setErrorMessage(compilationResult.getError());
                result.setPassedTestCases(0);
                result.setTotalTestCases(1);
                sendResult(result);
                return;
            }

            CodeExecutor.ExecutionResult executionResult =
                    codeExecutor.execute(request.getSourceCode(), request.getLanguage(), String.valueOf(request.getTaskId()));
            result.setTotalTestCases(1);

            if (!executionResult.isSuccess()) {
                result.setStatus(JudgeResult.Status.FAILED);
                result.setVerdict(executionResult.getError());
                result.setErrorMessage(executionResult.getError());
                result.setPassedTestCases(0);
                result.setExecutionTime(executionResult.getExecutionTime());
                result.setMemoryUsed(executionResult.getMemoryUsed());
                sendResult(result);
                return;
            }

            result.setStatus(JudgeResult.Status.ACCEPTED);
            result.setVerdict("Accepted");
            result.setPassedTestCases(1);
            result.setExecutionTime(executionResult.getExecutionTime());
            result.setMemoryUsed(executionResult.getMemoryUsed());
            sendResult(result);

        } catch (Exception e) {
            log.error("Error judging submission {}", request.getSubmissionId(), e);
            result.setStatus(JudgeResult.Status.FAILED);
            result.setVerdict("System Error");
            result.setErrorMessage(e.getMessage());
            result.setPassedTestCases(0);
            result.setTotalTestCases(1);
            sendResult(result);
        }
    }

    private void sendResult(JudgeResult result) {
        result.setAccepted(result.getStatus() == JudgeResult.Status.ACCEPTED);
        kafkaTemplate.send("judge-results", result);
        log.info("Sent judge result for submission {}: {}", result.getSubmissionId(), result.getStatus());
    }
}
