package iopwisp.user_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Body for PATCH /users/me. All fields optional — only non-null fields are applied.
 * Matches the settings page in the frontend (app/routes/settings.tsx).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class UserUpdateRequest {
    private String fullName;
    private String bio;
    private String avatarUrl;
    private String location;
    private String website;
    /** "dark" | "light" */
    private String theme;
}
