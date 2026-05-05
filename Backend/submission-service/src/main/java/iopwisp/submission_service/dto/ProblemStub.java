package iopwisp.submission_service.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Minimal DTO used when resolving a problem slug via task-service. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class ProblemStub {
    private Long id;
    private String slug;
    private String title;
    private String difficulty;
}
