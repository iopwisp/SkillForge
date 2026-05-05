package iopwisp.submission_service.service;

import iopwisp.submission_service.dto.JudgeRequest;
import iopwisp.submission_service.dto.JudgeResultEvent;
import iopwisp.submission_service.dto.NotificationEvent;
import iopwisp.submission_service.dto.SubmissionRequest;
import iopwisp.submission_service.dto.SubmissionResponse;
import iopwisp.submission_service.model.Submission;
import iopwisp.submission_service.repository.SubmissionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class SubmissionService {

    private final SubmissionRepository submissionRepository;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final SubmissionRateLimitService submissionRateLimitService;

    @Transactional
    public SubmissionResponse submitCode(Long userId, SubmissionRequest request) {
        submissionRateLimitService.assertWithinLimit(userId);

        Submission submission = new Submission();
        submission.setTaskId(request.getTaskId());
        submission.setUserId(userId);
        submission.setCode(request.getSourceCode());
        submission.setLanguage(request.getLanguage());
        submission.setStatus(Submission.Status.RUNNING);

        submission = submissionRepository.save(submission);

        JudgeRequest judgeRequest = new JudgeRequest();
        judgeRequest.setSubmissionId(submission.getId());
        judgeRequest.setTaskId(submission.getTaskId());
        judgeRequest.setUserId(submission.getUserId());
        judgeRequest.setSourceCode(submission.getCode());
        judgeRequest.setLanguage(submission.getLanguage());

        kafkaTemplate.send("submission.created", judgeRequest);
        log.info("Submission {} sent to judge service", submission.getId());

        return mapToResponse(submission);
    }

    @Transactional(readOnly = true)
    public SubmissionResponse getSubmission(Long submissionId) {
        Submission submission = submissionRepository.findById(submissionId)
                .orElseThrow(() -> new ResourceNotFoundException("Submission not found with id: " + submissionId));
        return mapToResponse(submission);
    }

    @Transactional(readOnly = true)
    public List<SubmissionResponse> getUserSubmissions(Long userId) {
        return submissionRepository.findByUserId(userId).stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<SubmissionResponse> getTaskSubmissions(Long taskId) {
        return submissionRepository.findByTaskId(taskId).stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public void updateSubmissionResult(Long submissionId, Submission.Status status, String verdict,
                                        Integer passedTestCases, Integer totalTestCases,
                                        Integer executionTime, Integer memoryUsed, String errorMessage) {
        Submission submission = submissionRepository.findById(submissionId)
                .orElseThrow(() -> new ResourceNotFoundException("Submission not found with id: " + submissionId));

        submission.setStatus(status);
        submission.setVerdict(verdict);
        submission.setPassedTestCases(passedTestCases);
        submission.setTotalTestCases(totalTestCases);
        submission.setExecutionTime(executionTime);
        submission.setMemoryUsed(memoryUsed);
        submission.setErrorMessage(errorMessage);

        submissionRepository.save(submission);
        log.info("Submission {} updated with status {}", submissionId, status);
    }

    @KafkaListener(topics = "judge-results", groupId = "submission-service-group")
    public void handleJudgeResult(JudgeResultEvent event) {
        log.info("Received judge result for submission {}: {}", event.getSubmissionId(), event.getStatus());
        Submission.Status status = Boolean.TRUE.equals(event.getAccepted())
                ? Submission.Status.ACCEPTED
                : Submission.Status.FAILED;

        updateSubmissionResult(
                event.getSubmissionId(),
                status,
                event.getVerdict(),
                event.getPassedTestCases(),
                event.getTotalTestCases(),
                event.getExecutionTime(),
                event.getMemoryUsed(),
                event.getErrorMessage()
        );

        String title = Boolean.TRUE.equals(event.getAccepted()) ? "Solution Accepted!" : "Submission Result";
        String message = String.format("Submission #%d: %s - %d/%d test cases passed",
                event.getSubmissionId(),
                event.getVerdict(),
                event.getPassedTestCases() != null ? event.getPassedTestCases() : 0,
                event.getTotalTestCases() != null ? event.getTotalTestCases() : 0);

        NotificationEvent notification = NotificationEvent.builder()
                .userId(event.getUserId())
                .type("SUBMISSION_RESULT")
                .title(title)
                .message(message)
                .build();

        kafkaTemplate.send("notifications", notification);
        log.info("Notification sent for submission {}", event.getSubmissionId());
    }

    private SubmissionResponse mapToResponse(Submission submission) {
        SubmissionResponse response = new SubmissionResponse();
        response.setId(submission.getId());
        response.setTaskId(submission.getTaskId());
        response.setUserId(submission.getUserId());
        response.setSourceCode(submission.getCode());
        response.setLanguage(submission.getLanguage());
        response.setStatus(submission.getStatus());
        response.setVerdict(submission.getVerdict());
        response.setPassedTestCases(submission.getPassedTestCases());
        response.setTotalTestCases(submission.getTotalTestCases());
        response.setExecutionTime(submission.getExecutionTime());
        response.setMemoryUsed(submission.getMemoryUsed());
        response.setErrorMessage(submission.getErrorMessage());
        response.setSubmittedAt(submission.getSubmittedAt());
        return response;
    }
}
