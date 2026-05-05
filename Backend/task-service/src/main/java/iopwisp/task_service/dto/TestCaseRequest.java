package iopwisp.task_service.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TestCaseRequest {

    private String input;

    @NotBlank(message = "Expected output is required")
    private String expectedOutput;

    private Boolean sample = false;
    private Integer orderIndex = 0;
}
