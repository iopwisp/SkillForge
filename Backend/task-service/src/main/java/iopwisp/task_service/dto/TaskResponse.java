package iopwisp.task_service.dto;

import iopwisp.task_service.model.Task;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TaskResponse {
    private Long id;
    private String title;
    private String slug;
    private String description;
    private String inputFormat;
    private String outputFormat;
    private String constraints;
    private String examples;
    private String tags;
    private Task.Type type;
    private Task.Difficulty difficulty;
    private Integer timeLimit;
    private Integer memoryLimit;
    private Long authorId;
    private Integer totalSubmissions;
    private Integer acceptedSubmissions;
    private Double acceptanceRate;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private List<TestCaseResponse> sampleTestCases;
}
