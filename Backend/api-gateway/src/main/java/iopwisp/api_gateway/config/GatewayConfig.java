package iopwisp.api_gateway.config;

import iopwisp.api_gateway.filter.AuthenticationFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@RequiredArgsConstructor
public class GatewayConfig {

    private final AuthenticationFilter authenticationFilter;

    @Bean
    public RouteLocator customRouteLocator(RouteLocatorBuilder builder) {
        return builder.routes()
                .route("auth-service", r -> r.path("/api/auth/**")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .stripPrefix(1))
                        .uri("lb://auth-service"))

                // Frontend-friendly alias: /api/users/leaderboard -> rating-service /ratings/leaderboard
                // (Leaderboard lives in rating-service, but the frontend namespaces it under /users.)
                // NOTE: must be declared BEFORE the generic /api/users/** route to take precedence.
                .route("users-leaderboard-alias", r -> r.path("/api/users/leaderboard")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .rewritePath("/api/users/leaderboard", "/ratings/leaderboard"))
                        .uri("lb://rating-service"))

                // Frontend-friendly alias: /api/users/profile/{username} -> /users/username/{username}
                .route("users-profile-alias", r -> r.path("/api/users/profile/**")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .rewritePath("/api/users/profile/(?<rest>.*)", "/users/username/${rest}"))
                        .uri("lb://user-service"))

                // Favorites list is served by task-service (it owns the favorites table).
                .route("users-favorites-alias", r -> r.path("/api/users/me/favorites")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .rewritePath("/api/users/me/favorites", "/problems/favorites"))
                        .uri("lb://task-service"))

                // Password change lives in auth-service (passwords aren't in user_profiles).
                .route("users-password-alias", r -> r.path("/api/users/me/password")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .rewritePath("/api/users/me/password", "/auth/password"))
                        .uri("lb://auth-service"))

                .route("user-service", r -> r.path("/api/users/**")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .stripPrefix(1))
                        .uri("lb://user-service"))

                .route("task-service", r -> r.path("/api/tasks/**")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .stripPrefix(1))
                        .uri("lb://task-service"))

                // Frontend-friendly route: /api/problems/** -> task-service /problems/**
                // (Dedicated ProblemController returns frontend-shape DTOs with slug-based lookups.)
                .route("problems", r -> r.path("/api/problems/**")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .stripPrefix(1))
                        .uri("lb://task-service"))

                // Categories (list) lives in task-service alongside problems.
                .route("categories", r -> r.path("/api/categories/**")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .stripPrefix(1))
                        .uri("lb://task-service"))

                .route("contest-service", r -> r.path("/api/contests/**")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .stripPrefix(1))
                        .uri("lb://task-service"))

                // Frontend-friendly alias: /api/submissions/me -> /submissions/my (naming mismatch)
                .route("submissions-me-alias", r -> r.path("/api/submissions/me")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .rewritePath("/api/submissions/me", "/submissions/my"))
                        .uri("lb://submission-service"))

                // Test-run: /api/submissions/{slug}/run -> /submissions/by-slug/{slug}/run.
                // MUST come before the /{slug} submit alias below so the /run suffix matches first.
                .route("submissions-run-alias", r -> r.path("/api/submissions/*/run")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .rewritePath("/api/submissions/(?<slug>[^/]+)/run", "/submissions/by-slug/${slug}/run"))
                        .uri("lb://submission-service"))

                // Submit by slug: /api/submissions/{slug} (POST) -> /submissions/by-slug/{slug}.
                // Uses a predicate that rejects the exact static sub-paths we've already handled
                // ("me") so the earlier route still wins. The segment regex [^/]+ also naturally
                // excludes multi-segment paths (e.g. /{slug}/run already matched above).
                .route("submissions-submit-by-slug", r -> r.path("/api/submissions/{slug}")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .rewritePath("/api/submissions/(?<slug>[^/]+)", "/submissions/by-slug/${slug}"))
                        .uri("lb://submission-service"))

                .route("submission-service", r -> r.path("/api/submissions/**")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .stripPrefix(1))
                        .uri("lb://submission-service"))

                .route("rating-service", r -> r.path("/api/ratings/**")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .stripPrefix(1))
                        .uri("lb://rating-service"))

                .route("notification-service", r -> r.path("/api/notifications/**")
                        .filters(f -> f.filter(authenticationFilter.apply(new AuthenticationFilter.Config()))
                                .stripPrefix(1))
                        .uri("lb://notification-service"))

                .build();
    }
}
