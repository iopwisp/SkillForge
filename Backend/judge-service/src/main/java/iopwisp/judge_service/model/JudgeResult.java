package iopwisp.judge_service.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class JudgeResult {
    private Long submissionId;
    private Long userId;
    private Long taskId;
    private Status status;
    private String verdict;
    private Integer passedTestCases;
    private Integer totalTestCases;
    private Integer executionTime;
    private Integer memoryUsed;
    private String errorMessage;
    private Boolean accepted;
    private String difficulty;

    public enum Status {
        ACCEPTED, FAILED
    }
}
