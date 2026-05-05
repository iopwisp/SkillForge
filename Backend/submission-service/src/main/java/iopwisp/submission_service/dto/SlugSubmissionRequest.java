package iopwisp.submission_service.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Body for slug-based submission endpoints: {@code POST /submissions/by-slug/{slug}}
 * and {@code POST /submissions/by-slug/{slug}/run}. The task id is resolved from
 * the path variable via task-service lookup, so the body only carries code + language.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class SlugSubmissionRequest {

    @JsonAlias("sourceCode")
    @NotBlank(message = "Source code is required")
    private String code;

    @NotBlank(message = "Language is required")
    private String language;
}
