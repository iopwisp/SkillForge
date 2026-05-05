package iopwisp.user_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SubmissionSummaryResponse {
    private Long id;
    private Long taskId;
    private Long userId;
    private String code;
    private String language;
    private String status;
    private String verdict;
    private Integer passedTestCases;
    private Integer totalTestCases;
    private Integer executionTime;
    private Integer memoryUsed;
    private String errorMessage;
    private LocalDateTime submittedAt;
}
