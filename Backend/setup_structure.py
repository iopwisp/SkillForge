#!/usr/bin/env python3
"""
setup_structure.py - Creates remaining directories and files for user-service and task-service.
Run from: C:\Users\iopwisp\Downloads\TuskHub\Backend\
Usage: python setup_structure.py
"""
import os

BASE = os.path.dirname(os.path.abspath(__file__))
USER_SVC = os.path.join(BASE, "user-service", "src", "main", "java", "iopwisp", "user_service")
TASK_SVC = os.path.join(BASE, "task-service", "src", "main", "java", "iopwisp", "task_service")
USER_RES = os.path.join(BASE, "user-service", "src", "main", "resources")
TASK_RES = os.path.join(BASE, "task-service", "src", "main", "resources")
USER_TEST = os.path.join(BASE, "user-service", "src", "test", "java", "iopwisp", "user_service")
TASK_TEST = os.path.join(BASE, "task-service", "src", "test", "java", "iopwisp", "task_service")


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print(f"  Created: {os.path.relpath(path, BASE)}")


# ─── USER-SERVICE: security/JwtAuthFilter.java ───────────────────────────────
write(os.path.join(USER_SVC, "security", "JwtAuthFilter.java"), """\
package iopwisp.user_service.security;

import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.crypto.SecretKey;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return request.getServletPath().startsWith("/actuator/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);
            try {
                SecretKey key = Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8));
                Claims claims = Jwts.parser()
                        .verifyWith(key)
                        .build()
                        .parseSignedClaims(token)
                        .getPayload();
                String username = claims.getSubject();
                String role = claims.get("role", String.class);
                if (username != null && SecurityContextHolder.getContext().getAuthentication() == null) {
                    UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                            username, null, List.of(new SimpleGrantedAuthority("ROLE_" + role)));
                    auth.setDetails(claims);
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
            } catch (JwtException e) {
                // Invalid token - continue without authentication
            }
        }
        filterChain.doFilter(request, response);
    }
}
""")

# ─── USER-SERVICE: exception/ResourceNotFoundException.java ──────────────────
write(os.path.join(USER_SVC, "exception", "ResourceNotFoundException.java"), """\
package iopwisp.user_service.exception;

public class ResourceNotFoundException extends RuntimeException {
    public ResourceNotFoundException(String message) {
        super(message);
    }
}
""")

# ─── USER-SERVICE: exception/ErrorResponse.java ──────────────────────────────
write(os.path.join(USER_SVC, "exception", "ErrorResponse.java"), """\
package iopwisp.user_service.exception;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ErrorResponse {
    private LocalDateTime timestamp;
    private int status;
    private String error;
    private String message;
    private String path;
}
""")

# ─── USER-SERVICE: exception/GlobalExceptionHandler.java ─────────────────────
write(os.path.join(USER_SVC, "exception", "GlobalExceptionHandler.java"), """\
package iopwisp.user_service.exception;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.LocalDateTime;
import java.util.stream.Collectors;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleResourceNotFound(
            ResourceNotFoundException ex, HttpServletRequest request) {
        return ResponseEntity.status(404).body(new ErrorResponse(
                LocalDateTime.now(), 404, "Not Found", ex.getMessage(), request.getRequestURI()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(
            MethodArgumentNotValidException ex, HttpServletRequest request) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .map(e -> e.getField() + ": " + e.getDefaultMessage())
                .collect(Collectors.joining(", "));
        return ResponseEntity.badRequest().body(new ErrorResponse(
                LocalDateTime.now(), 400, "Bad Request", message, request.getRequestURI()));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<ErrorResponse> handleRuntime(
            RuntimeException ex, HttpServletRequest request) {
        return ResponseEntity.badRequest().body(new ErrorResponse(
                LocalDateTime.now(), 400, "Bad Request", ex.getMessage(), request.getRequestURI()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGeneral(
            Exception ex, HttpServletRequest request) {
        return ResponseEntity.status(500).body(new ErrorResponse(
                LocalDateTime.now(), 500, "Internal Server Error", ex.getMessage(), request.getRequestURI()));
    }
}
""")

# ─── USER-SERVICE: db/migration/V1__init_user.sql ────────────────────────────
write(os.path.join(USER_RES, "db", "migration", "V1__init_user.sql"), """\
CREATE TABLE IF NOT EXISTS user_profiles (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(100),
    bio TEXT,
    avatar_url VARCHAR(255),
    country VARCHAR(100),
    organization VARCHAR(100),
    solved_problems INTEGER NOT NULL DEFAULT 0,
    total_submissions INTEGER NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username);
CREATE INDEX IF NOT EXISTS idx_user_profiles_rating ON user_profiles(rating DESC);
""")

# ─── USER-SERVICE: test/UserProfileServiceTest.java ──────────────────────────
write(os.path.join(USER_TEST, "service", "UserProfileServiceTest.java"), """\
package iopwisp.user_service.service;

import iopwisp.user_service.dto.UserProfileRequest;
import iopwisp.user_service.dto.UserProfileResponse;
import iopwisp.user_service.exception.ResourceNotFoundException;
import iopwisp.user_service.model.UserProfile;
import iopwisp.user_service.repository.UserProfileRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class UserProfileServiceTest {

    @Mock
    private UserProfileRepository userProfileRepository;

    @InjectMocks
    private UserProfileService userProfileService;

    @Test
    void getProfile_success() {
        UserProfile profile = new UserProfile();
        profile.setId(1L);
        profile.setUserId(42L);
        profile.setUsername("alice");
        when(userProfileRepository.findByUserId(42L)).thenReturn(Optional.of(profile));

        UserProfileResponse response = userProfileService.getProfile(42L);

        assertThat(response.getUserId()).isEqualTo(42L);
        assertThat(response.getUsername()).isEqualTo("alice");
    }

    @Test
    void getProfile_notFound_throwsResourceNotFoundException() {
        when(userProfileRepository.findByUserId(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> userProfileService.getProfile(99L))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("99");
    }

    @Test
    void createProfile_success() {
        when(userProfileRepository.findByUserId(1L)).thenReturn(Optional.empty());

        UserProfile saved = new UserProfile();
        saved.setId(1L);
        saved.setUserId(1L);
        saved.setUsername("bob");
        saved.setSolvedProblems(0);
        saved.setTotalSubmissions(0);
        saved.setRating(0);
        when(userProfileRepository.save(any())).thenReturn(saved);

        UserProfileRequest request = new UserProfileRequest("Bob Smith", null, null, null, null);
        UserProfileResponse response = userProfileService.createProfile(1L, "bob", request);

        assertThat(response.getUsername()).isEqualTo("bob");
        verify(userProfileRepository).save(any(UserProfile.class));
    }

    @Test
    void updateProfile_success() {
        UserProfile existing = new UserProfile();
        existing.setId(1L);
        existing.setUserId(1L);
        existing.setUsername("carol");
        existing.setSolvedProblems(0);
        existing.setTotalSubmissions(0);
        existing.setRating(0);
        when(userProfileRepository.findByUserId(1L)).thenReturn(Optional.of(existing));
        when(userProfileRepository.save(any())).thenReturn(existing);

        UserProfileRequest request = new UserProfileRequest("Carol Updated", "New bio", null, "US", null);
        UserProfileResponse response = userProfileService.updateProfile(1L, request);

        assertThat(response.getUsername()).isEqualTo("carol");
        verify(userProfileRepository).save(any(UserProfile.class));
    }
}
""")

# ─── TASK-SERVICE: security/JwtAuthFilter.java ───────────────────────────────
write(os.path.join(TASK_SVC, "security", "JwtAuthFilter.java"), """\
package iopwisp.task_service.security;

import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.crypto.SecretKey;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return request.getServletPath().startsWith("/actuator/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);
            try {
                SecretKey key = Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8));
                Claims claims = Jwts.parser()
                        .verifyWith(key)
                        .build()
                        .parseSignedClaims(token)
                        .getPayload();
                String username = claims.getSubject();
                String role = claims.get("role", String.class);
                if (username != null && SecurityContextHolder.getContext().getAuthentication() == null) {
                    UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                            username, null, List.of(new SimpleGrantedAuthority("ROLE_" + role)));
                    auth.setDetails(claims);
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
            } catch (JwtException e) {
                // Invalid token - continue without authentication
            }
        }
        filterChain.doFilter(request, response);
    }
}
""")

# ─── TASK-SERVICE: exception/ResourceNotFoundException.java ──────────────────
write(os.path.join(TASK_SVC, "exception", "ResourceNotFoundException.java"), """\
package iopwisp.task_service.exception;

public class ResourceNotFoundException extends RuntimeException {
    public ResourceNotFoundException(String message) {
        super(message);
    }
}
""")

# ─── TASK-SERVICE: exception/ErrorResponse.java ──────────────────────────────
write(os.path.join(TASK_SVC, "exception", "ErrorResponse.java"), """\
package iopwisp.task_service.exception;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ErrorResponse {
    private LocalDateTime timestamp;
    private int status;
    private String error;
    private String message;
    private String path;
}
""")

# ─── TASK-SERVICE: exception/GlobalExceptionHandler.java ─────────────────────
write(os.path.join(TASK_SVC, "exception", "GlobalExceptionHandler.java"), """\
package iopwisp.task_service.exception;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.LocalDateTime;
import java.util.stream.Collectors;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleResourceNotFound(
            ResourceNotFoundException ex, HttpServletRequest request) {
        return ResponseEntity.status(404).body(new ErrorResponse(
                LocalDateTime.now(), 404, "Not Found", ex.getMessage(), request.getRequestURI()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(
            MethodArgumentNotValidException ex, HttpServletRequest request) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .map(e -> e.getField() + ": " + e.getDefaultMessage())
                .collect(Collectors.joining(", "));
        return ResponseEntity.badRequest().body(new ErrorResponse(
                LocalDateTime.now(), 400, "Bad Request", message, request.getRequestURI()));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<ErrorResponse> handleRuntime(
            RuntimeException ex, HttpServletRequest request) {
        return ResponseEntity.badRequest().body(new ErrorResponse(
                LocalDateTime.now(), 400, "Bad Request", ex.getMessage(), request.getRequestURI()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGeneral(
            Exception ex, HttpServletRequest request) {
        return ResponseEntity.status(500).body(new ErrorResponse(
                LocalDateTime.now(), 500, "Internal Server Error", ex.getMessage(), request.getRequestURI()));
    }
}
""")

# ─── TASK-SERVICE: db/migration/V1__init_task.sql ────────────────────────────
write(os.path.join(TASK_RES, "db", "migration", "V1__init_task.sql"), """\
CREATE TABLE IF NOT EXISTS tasks (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE,
    description TEXT NOT NULL,
    input_format TEXT,
    output_format TEXT,
    constraints TEXT,
    examples TEXT,
    tags TEXT,
    type VARCHAR(20) NOT NULL DEFAULT 'ALGO',
    difficulty VARCHAR(10) NOT NULL DEFAULT 'EASY',
    time_limit INTEGER NOT NULL DEFAULT 1000,
    memory_limit INTEGER NOT NULL DEFAULT 256,
    author_id BIGINT NOT NULL,
    total_submissions INTEGER NOT NULL DEFAULT 0,
    accepted_submissions INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS test_cases (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL,
    input TEXT,
    expected_output TEXT NOT NULL,
    is_sample BOOLEAN NOT NULL DEFAULT FALSE,
    order_index INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contests (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    created_by BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'UPCOMING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_difficulty ON tasks(difficulty);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_slug ON tasks(slug);
CREATE INDEX IF NOT EXISTS idx_test_cases_task_id ON test_cases(task_id);
CREATE INDEX IF NOT EXISTS idx_contests_status ON contests(status);
CREATE INDEX IF NOT EXISTS idx_contests_start_time ON contests(start_time);
""")

# ─── TASK-SERVICE: test/TaskServiceTest.java ─────────────────────────────────
write(os.path.join(TASK_TEST, "service", "TaskServiceTest.java"), """\
package iopwisp.task_service.service;

import iopwisp.task_service.dto.TaskRequest;
import iopwisp.task_service.dto.TaskResponse;
import iopwisp.task_service.exception.ResourceNotFoundException;
import iopwisp.task_service.model.Task;
import iopwisp.task_service.repository.TaskRepository;
import iopwisp.task_service.repository.TestCaseRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collections;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class TaskServiceTest {

    @Mock
    private TaskRepository taskRepository;

    @Mock
    private TestCaseRepository testCaseRepository;

    @InjectMocks
    private TaskService taskService;

    @Test
    void createTask_success() {
        TaskRequest request = new TaskRequest();
        request.setTitle("Two Sum");
        request.setDescription("Find two numbers that add to target.");
        request.setDifficulty(Task.Difficulty.EASY);
        request.setTimeLimit(1000);
        request.setMemoryLimit(256);

        Task saved = new Task();
        saved.setId(1L);
        saved.setTitle("Two Sum");
        saved.setDescription("Find two numbers that add to target.");
        saved.setDifficulty(Task.Difficulty.EASY);
        saved.setType(Task.Type.ALGO);
        saved.setTimeLimit(1000);
        saved.setMemoryLimit(256);
        saved.setAuthorId(1L);
        saved.setTotalSubmissions(0);
        saved.setAcceptedSubmissions(0);

        when(taskRepository.save(any())).thenReturn(saved);
        when(testCaseRepository.findByTaskIdAndSample(any(), any())).thenReturn(Collections.emptyList());

        TaskResponse response = taskService.createTask(1L, request);

        assertThat(response.getTitle()).isEqualTo("Two Sum");
        assertThat(response.getDifficulty()).isEqualTo(Task.Difficulty.EASY);
        verify(taskRepository).save(any(Task.class));
    }

    @Test
    void getTask_success() {
        Task task = new Task();
        task.setId(1L);
        task.setTitle("FizzBuzz");
        task.setDifficulty(Task.Difficulty.EASY);
        task.setType(Task.Type.ALGO);
        task.setTotalSubmissions(0);
        task.setAcceptedSubmissions(0);

        when(taskRepository.findById(1L)).thenReturn(Optional.of(task));
        when(testCaseRepository.findByTaskIdAndSample(any(), any())).thenReturn(Collections.emptyList());

        TaskResponse response = taskService.getTask(1L);

        assertThat(response.getTitle()).isEqualTo("FizzBuzz");
    }

    @Test
    void getTask_notFound_throwsResourceNotFoundException() {
        when(taskRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> taskService.getTask(99L))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("99");
    }

    @Test
    void updateTask_success() {
        Task existing = new Task();
        existing.setId(1L);
        existing.setTitle("Old Title");
        existing.setDifficulty(Task.Difficulty.EASY);
        existing.setType(Task.Type.ALGO);
        existing.setTimeLimit(1000);
        existing.setMemoryLimit(256);
        existing.setAuthorId(1L);
        existing.setTotalSubmissions(5);
        existing.setAcceptedSubmissions(3);

        when(taskRepository.findById(1L)).thenReturn(Optional.of(existing));
        when(taskRepository.save(any())).thenReturn(existing);
        when(testCaseRepository.findByTaskIdAndSample(any(), any())).thenReturn(Collections.emptyList());

        TaskRequest request = new TaskRequest();
        request.setTitle("New Title");
        request.setDescription("Updated description");
        request.setDifficulty(Task.Difficulty.MEDIUM);
        request.setTimeLimit(2000);
        request.setMemoryLimit(512);

        TaskResponse response = taskService.updateTask(1L, request);

        assertThat(response).isNotNull();
        verify(taskRepository).save(any(Task.class));
    }

    @Test
    void deleteTask_success() {
        when(taskRepository.existsById(1L)).thenReturn(true);
        when(testCaseRepository.findByTaskId(1L)).thenReturn(Collections.emptyList());

        taskService.deleteTask(1L);

        verify(taskRepository).deleteById(1L);
    }
}
""")

print("\\n✅ All files created successfully!")
print("\\nCreated directories:")
for svc_name, svc_path in [("user-service", USER_SVC), ("task-service", TASK_SVC)]:
    for sub in ["security", "exception"]:
        d = os.path.join(svc_path, sub)
        if os.path.exists(d):
            print(f"  {svc_name}/{sub}/")
for svc_name, res_path in [("user-service", USER_RES), ("task-service", TASK_RES)]:
    d = os.path.join(res_path, "db", "migration")
    if os.path.exists(d):
        print(f"  {svc_name}/src/main/resources/db/migration/")
