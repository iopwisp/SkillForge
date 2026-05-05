package iopwisp.task_service.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "tasks")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Task {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String title;

    @Column(unique = true)
    private String slug;

    @Column(columnDefinition = "TEXT", nullable = false)
    private String description;

    @Column(columnDefinition = "TEXT")
    private String inputFormat;

    @Column(columnDefinition = "TEXT")
    private String outputFormat;

    @Column(columnDefinition = "TEXT")
    private String constraints;

    @Column(columnDefinition = "TEXT")
    private String examples;

    @Column(columnDefinition = "TEXT")
    private String tags;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Type type = Type.ALGO;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Difficulty difficulty = Difficulty.EASY;

    @Column(nullable = false)
    private Integer timeLimit = 1000; // milliseconds

    @Column(nullable = false)
    private Integer memoryLimit = 256; // MB

    @Column(nullable = false)
    private Long authorId;

    @Column(nullable = false)
    private Integer totalSubmissions = 0;

    @Column(nullable = false)
    private Integer acceptedSubmissions = 0;

    // Frontend-compatibility columns (added in V2 migration)

    @ManyToOne(fetch = FetchType.LAZY, optional = true)
    @JoinColumn(name = "category_id")
    private Category category;

    @Column(name = "is_premium", nullable = false)
    private Boolean isPremium = false;

    /** Newline-separated hints list. */
    @Column(columnDefinition = "TEXT")
    private String hints;

    /** JSON object: language -> starter code snippet. */
    @Column(name = "starter_code", columnDefinition = "TEXT")
    private String starterCode;

    /** SQL DDL/DML to run before SQL submission (nullable). */
    @Column(name = "sql_setup", columnDefinition = "TEXT")
    private String sqlSetup;

    /** Required JS function name for JS-judged problems. */
    @Column(name = "function_name", length = 100)
    private String functionName;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;

    public enum Difficulty {
        EASY, MEDIUM, HARD
    }

    public enum Type {
        ALGO, SQL, FRONTEND, BACKEND
    }
}
