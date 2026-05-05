package iopwisp.user_service.controller;

import iopwisp.user_service.dto.DashboardResponse;
import iopwisp.user_service.dto.UserProfileRequest;
import iopwisp.user_service.dto.UserProfileResponse;
import iopwisp.user_service.dto.UserUpdateRequest;
import iopwisp.user_service.dto.SubmissionSummaryResponse;
import io.jsonwebtoken.Claims;
import iopwisp.user_service.service.UserProfileService;
import iopwisp.user_service.service.SubmissionQueryService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/users")
@RequiredArgsConstructor
public class UserProfileController {

    private final UserProfileService userProfileService;
    private final SubmissionQueryService submissionQueryService;

    @PostMapping
    public ResponseEntity<UserProfileResponse> createProfile(
            @RequestParam Long userId,
            @RequestParam String username,
            @Valid @RequestBody UserProfileRequest request) {
        return ResponseEntity.ok(userProfileService.createProfile(userId, username, request));
    }

    @GetMapping("/{userId}")
    public ResponseEntity<UserProfileResponse> getProfile(@PathVariable Long userId) {
        return ResponseEntity.ok(userProfileService.getProfile(userId));
    }

    @GetMapping("/me")
    public ResponseEntity<UserProfileResponse> getCurrentProfile() {
        Claims claims = currentClaims();
        return ResponseEntity.ok(userProfileService.getCurrentProfile(
                claims.get("userId", Long.class),
                claims.getSubject()
        ));
    }

    @GetMapping("/me/submissions")
    public ResponseEntity<List<SubmissionSummaryResponse>> getCurrentUserSubmissions(
            @RequestHeader("Authorization") String authorizationHeader) {
        return ResponseEntity.ok(submissionQueryService.getCurrentUserSubmissions(authorizationHeader));
    }

    @PatchMapping("/me")
    public ResponseEntity<UserProfileResponse> updateCurrentProfile(@RequestBody UserUpdateRequest req) {
        Claims claims = currentClaims();
        return ResponseEntity.ok(userProfileService.updateCurrentProfile(
                claims.get("userId", Long.class),
                claims.getSubject(),
                req
        ));
    }

    @GetMapping("/me/dashboard")
    public ResponseEntity<DashboardResponse> getDashboard() {
        Claims claims = currentClaims();
        return ResponseEntity.ok(userProfileService.buildDashboard(
                claims.get("userId", Long.class),
                claims.getSubject()
        ));
    }

    @GetMapping("/username/{username}")
    public ResponseEntity<UserProfileResponse> getProfileByUsername(@PathVariable String username) {
        return ResponseEntity.ok(userProfileService.getProfileByUsername(username));
    }

    @PutMapping("/{userId}")
    public ResponseEntity<UserProfileResponse> updateProfile(
            @PathVariable Long userId,
            @Valid @RequestBody UserProfileRequest request) {
        return ResponseEntity.ok(userProfileService.updateProfile(userId, request));
    }

    @GetMapping
    public ResponseEntity<List<UserProfileResponse>> getAllProfiles() {
        return ResponseEntity.ok(userProfileService.getAllProfiles());
    }

    @PutMapping("/{userId}/stats")
    public ResponseEntity<Void> updateStats(
            @PathVariable Long userId,
            @RequestParam Integer solvedProblems,
            @RequestParam Integer totalSubmissions) {
        userProfileService.updateStats(userId, solvedProblems, totalSubmissions);
        return ResponseEntity.ok().build();
    }

    @PutMapping("/{userId}/rating")
    public ResponseEntity<Void> updateRating(
            @PathVariable Long userId,
            @RequestParam Integer rating) {
        userProfileService.updateRating(userId, rating);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("User Service is running");
    }

    private Claims currentClaims() {
        UsernamePasswordAuthenticationToken authentication =
                (UsernamePasswordAuthenticationToken) SecurityContextHolder.getContext().getAuthentication();
        return (Claims) authentication.getDetails();
    }
}
