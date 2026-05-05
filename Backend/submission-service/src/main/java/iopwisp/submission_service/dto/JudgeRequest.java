package iopwisp.submission_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class JudgeRequest {
    private Long submissionId;
    private Long taskId;
    private Long userId;
    private String sourceCode;
    private String language;
}
