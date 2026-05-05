package iopwisp.task_service.dto;

import iopwisp.task_service.model.Task;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TaskRequest {

    @NotBlank(message = "Title is required")
    private String title;

    private String slug;

    @NotBlank(message = "Description is required")
    private String description;

    private String inputFormat;
    private String outputFormat;
    private String constraints;
    private String examples;
    private String tags;

    private Task.Type type = Task.Type.ALGO;

    @NotNull(message = "Difficulty is required")
    private Task.Difficulty difficulty;

    @Positive(message = "Time limit must be positive")
    private Integer timeLimit = 1000;

    @Positive(message = "Memory limit must be positive")
    private Integer memoryLimit = 256;
}
