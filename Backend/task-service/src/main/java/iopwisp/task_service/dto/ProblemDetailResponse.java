package iopwisp.task_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

import java.util.List;
import java.util.Map;

/** Matches the frontend `ProblemDetail` (extends ProblemSummary) interface. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
public class ProblemDetailResponse extends ProblemSummaryResponse {
    private String description;
    private List<Example> examples;
    private String constraints;
    private List<String> hints;
    private Map<String, String> starterCode;
    private String sqlSetup;
    private String functionName;
    private int timeLimitMs;
    private int memoryLimitMb;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Example {
        private String input;
        private String output;
        private String explanation;
    }
}
