package iopwisp.submission_service.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;

@Service
public class SubmissionRateLimitService {

    private final StringRedisTemplate stringRedisTemplate;
    private final int maxPerMinute;

    public SubmissionRateLimitService(
            StringRedisTemplate stringRedisTemplate,
            @Value("${submission.rate-limit.max-per-minute}") int maxPerMinute) {
        this.stringRedisTemplate = stringRedisTemplate;
        this.maxPerMinute = maxPerMinute;
    }

    public void assertWithinLimit(Long userId) {
        String key = "submission-rate-limit:" + userId;
        Long current = stringRedisTemplate.opsForValue().increment(key);

        if (Long.valueOf(1L).equals(current)) {
            stringRedisTemplate.expire(key, Duration.ofMinutes(1));
        }

        if (current != null && current > maxPerMinute) {
            throw new SubmissionRateLimitException(
                    "Submission rate limit exceeded. Please wait before submitting again.");
        }
    }
}
