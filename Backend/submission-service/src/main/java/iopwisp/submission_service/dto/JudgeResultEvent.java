package iopwisp.submission_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class JudgeResultEvent {
    private Long submissionId;
    private String status;
    private String verdict;
    private Integer passedTestCases;
    private Integer totalTestCases;
    private Integer executionTime;
    private Integer memoryUsed;
    private String errorMessage;
    private Long userId;
    private Long taskId;
    private Boolean accepted;
    private String difficulty;
}
