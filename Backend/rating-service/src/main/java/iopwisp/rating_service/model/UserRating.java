package iopwisp.rating_service.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "user_ratings")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class UserRating {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private Long userId;

    @Column(length = 50)
    private String username;

    @Column(nullable = false)
    private Integer rating = 1500; // Starting ELO rating

    @Column(nullable = false)
    private Integer solvedEasy = 0;

    @Column(nullable = false)
    private Integer solvedMedium = 0;

    @Column(nullable = false)
    private Integer solvedHard = 0;

    @Column(nullable = false)
    private Integer totalSolved = 0;

    @Column(nullable = false)
    private Integer contestsParticipated = 0;

    @Column(nullable = false)
    private Integer rank = 0;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
