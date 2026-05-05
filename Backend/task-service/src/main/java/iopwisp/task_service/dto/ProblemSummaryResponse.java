package iopwisp.task_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

import java.util.List;

/** Matches the frontend `ProblemSummary` interface in app/lib/types.ts. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@SuperBuilder
public class ProblemSummaryResponse {
    private Long id;
    private String slug;
    private String title;

    /** "EASY" | "MEDIUM" | "HARD" (Task.Difficulty name). */
    private String difficulty;

    /** "ALGORITHM" | "SQL" | "BACKEND" | "FRONTEND" (frontend enum). */
    private String problemType;

    private List<String> tags;

    /** {slug, name} or null. */
    private CategoryRef category;

    private boolean isPremium;
    private int totalSubmissions;
    private int acceptedSubmissions;
    private double acceptanceRate;

    /** "solved" | "attempted" | null. */
    private String status;

    private boolean favorited;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CategoryRef {
        private String slug;
        private String name;
    }
}
