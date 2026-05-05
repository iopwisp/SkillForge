package iopwisp.rating_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class UserRatingResponse {
    private Long id;
    private Long userId;
    private String username;
    private Integer rating;
    private Integer solvedEasy;
    private Integer solvedMedium;
    private Integer solvedHard;
    private Integer totalSolved;
    private Integer contestsParticipated;
    private Integer rank;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
