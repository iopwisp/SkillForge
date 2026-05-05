package iopwisp.user_service.dto;

import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class UserProfileRequest {
    @Size(max = 100, message = "Full name must be at most 100 characters")
    private String fullName;

    @Size(max = 2000, message = "Bio must be at most 2000 characters")
    private String bio;

    @Size(max = 255, message = "Avatar URL must be at most 255 characters")
    private String avatarUrl;

    @Size(max = 100, message = "Country must be at most 100 characters")
    private String country;

    @Size(max = 100, message = "Organization must be at most 100 characters")
    private String organization;
}
