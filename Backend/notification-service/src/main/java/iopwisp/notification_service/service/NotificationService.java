package iopwisp.notification_service.service;

import iopwisp.notification_service.dto.NotificationEvent;
import iopwisp.notification_service.dto.NotificationResponse;
import iopwisp.notification_service.dto.ResourceNotFoundException;
import iopwisp.notification_service.model.Notification;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class NotificationService {

    private final NotificationRepository notificationRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final EmailService emailService;

    @KafkaListener(topics = "notifications", groupId = "notification-service-group")
    @Transactional
    public void handleNotification(NotificationEvent event) {
        log.info("Received notification for user {}: {}", event.getUserId(), event.getTitle());

        Notification notification = new Notification();
        notification.setUserId(event.getUserId());
        notification.setType(event.getType());
        notification.setTitle(event.getTitle());
        notification.setMessage(event.getMessage());
        notification.setRead(false);
        notification = notificationRepository.save(notification);

        sendWebSocketNotification(event.getUserId(), notification);

        if (event.getEmail() != null && !event.getEmail().isEmpty()) {
            emailService.sendEmail(event.getEmail(), event.getTitle(), event.getMessage());
        }

        log.info("Notification saved and sent to user {}", event.getUserId());
    }

    private void sendWebSocketNotification(Long userId, Notification notification) {
        try {
            NotificationResponse response = mapToResponse(notification);
            messagingTemplate.convertAndSendToUser(
                    userId.toString(),
                    "/topic/notifications",
                    response
            );
            log.info("WebSocket notification sent to user {}", userId);
        } catch (Exception e) {
            log.error("Error sending WebSocket notification", e);
        }
    }

    @Transactional(readOnly = true)
    public List<NotificationResponse> getUserNotifications(Long userId) {
        return notificationRepository.findByUserIdOrderByCreatedAtDesc(userId)
                .stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public void markAsRead(Long userId, Long id) {
        Notification notification = notificationRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Notification not found: " + id));
        if (!notification.getUserId().equals(userId)) {
            throw new ResourceNotFoundException("Notification not found: " + id);
        }
        notification.setRead(true);
        notificationRepository.save(notification);
        log.info("Notification {} marked as read", id);
    }

    @Transactional
    public void markAllAsRead(Long userId) {
        notificationRepository.markAllAsReadByUserId(userId);
        log.info("All notifications marked as read for user {}", userId);
    }

    @Transactional(readOnly = true)
    public long getUnreadCount(Long userId) {
        return notificationRepository.countByUserIdAndReadFalse(userId);
    }

    private NotificationResponse mapToResponse(Notification notification) {
        NotificationResponse response = new NotificationResponse();
        response.setId(notification.getId());
        response.setUserId(notification.getUserId());
        response.setType(notification.getType());
        response.setTitle(notification.getTitle());
        response.setMessage(notification.getMessage());
        response.setReadStatus(notification.isRead());
        response.setCreatedAt(notification.getCreatedAt());
        return response;
    }
}
