package iopwisp.auth_service.controller;

import iopwisp.auth_service.dto.AuthResponse;
import iopwisp.auth_service.dto.ChangePasswordRequest;
import iopwisp.auth_service.dto.LoginRequest;
import iopwisp.auth_service.dto.RefreshTokenRequest;
import iopwisp.auth_service.dto.RegisterRequest;
import iopwisp.auth_service.dto.UserResponse;
import iopwisp.auth_service.security.JwtTokenProvider;
import iopwisp.auth_service.service.AuthService;
import iopwisp.auth_service.service.InvalidTokenException;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;
    private final JwtTokenProvider jwtTokenProvider;

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request) {
        return ResponseEntity.ok(authService.register(request));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        return ResponseEntity.ok(authService.login(request));
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refreshToken(@Valid @RequestBody RefreshTokenRequest request) {
        return ResponseEntity.ok(authService.refreshToken(request));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@Valid @RequestBody RefreshTokenRequest request) {
        authService.logout(request.getRefreshToken());
        return ResponseEntity.ok().build();
    }

    @GetMapping("/me")
    public ResponseEntity<UserResponse> getMe(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (!StringUtils.hasText(authHeader) || !authHeader.startsWith("Bearer ")) {
            throw new InvalidTokenException("Invalid authorization header");
        }

        String token = authHeader.substring(7);
        if (!StringUtils.hasText(token) || !jwtTokenProvider.validateToken(token)) {
            throw new InvalidTokenException("Invalid authorization header");
        }

        String username = jwtTokenProvider.getUsernameFromToken(token);
        return ResponseEntity.ok(authService.getMe(username));
    }

    @PutMapping("/password")
    public ResponseEntity<Void> changePassword(
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            @Valid @RequestBody ChangePasswordRequest request) {
        if (!StringUtils.hasText(authHeader) || !authHeader.startsWith("Bearer ")) {
            throw new InvalidTokenException("Invalid authorization header");
        }
        String token = authHeader.substring(7);
        if (!StringUtils.hasText(token) || !jwtTokenProvider.validateToken(token)) {
            throw new InvalidTokenException("Invalid authorization header");
        }
        String username = jwtTokenProvider.getUsernameFromToken(token);
        authService.changePassword(username, request.getCurrentPassword(), request.getNewPassword());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("Auth Service is running");
    }
}
