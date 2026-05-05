package iopwisp.submission_service.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import iopwisp.submission_service.model.Submission;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SubmissionResponse {
    private Long id;
    private Long taskId;
    private Long userId;
    @JsonAlias("code")
    private String sourceCode;
    private String language;
    private Submission.Status status;
    private String verdict;
    private Integer passedTestCases;
    private Integer totalTestCases;
    private Integer executionTime;
    private Integer memoryUsed;
    private String errorMessage;
    private LocalDateTime submittedAt;
}
