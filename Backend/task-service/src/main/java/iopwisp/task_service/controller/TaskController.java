package iopwisp.task_service.controller;

import iopwisp.task_service.dto.*;
import iopwisp.task_service.model.Task;
import iopwisp.task_service.service.TaskService;
import io.jsonwebtoken.Claims;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/tasks")
@RequiredArgsConstructor
public class TaskController {

    private final TaskService taskService;

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<TaskResponse> createTask(@Valid @RequestBody TaskRequest request) {
        return ResponseEntity.ok(taskService.createTask(extractCurrentUserId(), request));
    }

    @GetMapping("/{taskId}")
    public ResponseEntity<TaskResponse> getTask(@PathVariable Long taskId) {
        return ResponseEntity.ok(taskService.getTask(taskId));
    }

    @GetMapping
    public ResponseEntity<Page<TaskResponse>> getAllTasks(
            Pageable pageable,
            @RequestParam(required = false) Task.Difficulty difficulty,
            @RequestParam(required = false) Task.Type type) {
        return ResponseEntity.ok(taskService.getAllTasks(pageable, difficulty, type));
    }

    @GetMapping("/difficulty/{difficulty}")
    public ResponseEntity<List<TaskResponse>> getTasksByDifficulty(@PathVariable Task.Difficulty difficulty) {
        return ResponseEntity.ok(taskService.getTasksByDifficulty(difficulty));
    }

    @PutMapping("/{taskId}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<TaskResponse> updateTask(
            @PathVariable Long taskId,
            @Valid @RequestBody TaskRequest request) {
        return ResponseEntity.ok(taskService.updateTask(taskId, request));
    }

    @DeleteMapping("/{taskId}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> deleteTask(@PathVariable Long taskId) {
        taskService.deleteTask(taskId);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/{taskId}/test-cases")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<TestCaseResponse> addTestCase(
            @PathVariable Long taskId,
            @Valid @RequestBody TestCaseRequest request) {
        return ResponseEntity.ok(taskService.addTestCase(taskId, request));
    }

    @GetMapping("/{taskId}/test-cases")
    public ResponseEntity<List<TestCaseResponse>> getTestCases(@PathVariable Long taskId) {
        return ResponseEntity.ok(taskService.getTestCases(taskId));
    }

    @PutMapping("/{taskId}/stats")
    public ResponseEntity<Void> updateTaskStats(
            @PathVariable Long taskId,
            @RequestParam boolean accepted) {
        taskService.updateTaskStats(taskId, accepted);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("Task Service is running");
    }

    private Long extractCurrentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof UsernamePasswordAuthenticationToken token
                && token.getDetails() instanceof Claims claims) {
            Object userId = claims.get("userId");
            if (userId instanceof Number number) {
                return number.longValue();
            }
        }
        return null;
    }
}
