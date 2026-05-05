package iopwisp.user_service.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "user_profiles")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class UserProfile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private Long userId;

    @Column(nullable = false)
    private String username;

    private String fullName;
    private String bio;
    private String avatarUrl;
    private String country;
    private String organization;

    // Frontend-compat fields (V2 migration)
    private String location;
    private String website;

    @Column(nullable = false, length = 10)
    private String theme = "dark";

    @Column(nullable = false)
    private Integer solvedProblems = 0;

    @Column(nullable = false)
    private Integer totalSubmissions = 0;

    @Column(nullable = false)
    private Integer rating = 0;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
