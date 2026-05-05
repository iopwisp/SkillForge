package iopwisp.task_service.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Matches the frontend `Category` interface in app/lib/types.ts. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CategoryResponse {
    private Long id;
    private String slug;
    private String name;
    private String description;
    private String icon;
    private String color;

    /** Frontend reads this in snake_case. */
    @JsonProperty("problem_count")
    private Integer problemCount;
}
