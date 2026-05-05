package iopwisp.rating_service.controller;

import iopwisp.rating_service.dto.UserRatingResponse;
import iopwisp.rating_service.service.RatingService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/ratings")
@RequiredArgsConstructor
public class RatingController {

    private final RatingService ratingService;

    @PostMapping("/user/{userId}")
    public ResponseEntity<UserRatingResponse> createUserRating(@PathVariable Long userId) {
        return ResponseEntity.ok(ratingService.createUserRating(userId));
    }

    @GetMapping("/user/{userId}")
    public ResponseEntity<UserRatingResponse> getUserRating(@PathVariable Long userId) {
        return ResponseEntity.ok(ratingService.getUserRating(userId));
    }

    @GetMapping("/leaderboard")
    public ResponseEntity<List<UserRatingResponse>> getLeaderboard(
            @PageableDefault(size = 50) Pageable pageable) {
        return ResponseEntity.ok(ratingService.getLeaderboard(pageable));
    }

    @PutMapping("/user/{userId}/contest")
    public ResponseEntity<Void> updateContestParticipation(
            @PathVariable Long userId,
            @RequestParam Integer ratingChange) {
        ratingService.updateContestParticipation(userId, ratingChange);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("Rating Service is running");
    }
}
