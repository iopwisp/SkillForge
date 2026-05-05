package iopwisp.task_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TestCaseResponse {
    private Long id;
    private Long taskId;
    private String input;
    private String expectedOutput;
    private Boolean sample;
    private Integer orderIndex;
}
