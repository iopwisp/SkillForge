package iopwisp.user_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class UserProfileResponse {
    private Long id;
    private Long userId;
    private String username;
    private String fullName;
    private String bio;
    private String avatarUrl;
    private String country;
    private String organization;
    private String location;
    private String website;
    private String theme;
    private Integer solvedProblems;
    private Integer totalSubmissions;
    private Integer rating;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
