package iopwisp.rating_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SubmissionEvent {
    private Long submissionId;
    private Long userId;
    private Long taskId;
    private String status;
    private String verdict;
    private Integer passedTestCases;
    private Integer totalTestCases;
    private Integer executionTime;
    private Integer memoryUsed;
    private String errorMessage;
    private Boolean accepted;
    private String difficulty;
}
