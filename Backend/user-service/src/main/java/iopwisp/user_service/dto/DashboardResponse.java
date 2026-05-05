package iopwisp.user_service.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Shape for GET /users/me/dashboard — matches the frontend `DashboardData` interface.
 * PASS 1: most cross-service fields are stubbed (empty lists, zeros). See TODOs below.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DashboardResponse {
    private Totals totals;
    private List<DifficultyEntry> solvedByDifficulty;
    private List<RecentSubmission> recentSubmissions;
    private List<Recommended> recommended;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class Totals {
        private int submissions;
        private int accepted;
        private double acceptanceRate;
        private int streak;
        private int rating;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class DifficultyEntry {
        private String difficulty;  // "EASY" | "MEDIUM" | "HARD"
        private int solved;
        private int total;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class RecentSubmission {
        private Long id;
        private String status;
        private String language;
        private Integer runtimeMs;
        private Integer memoryKb;
        private LocalDateTime createdAt;
        private ProblemRef problem;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class ProblemRef {
        private String slug;
        private String title;
        private String difficulty;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class Recommended {
        private Long id;
        private String slug;
        private String title;
        private String difficulty;
        private List<String> tags;
    }
}
