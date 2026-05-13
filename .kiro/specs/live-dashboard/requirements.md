# Requirements Document

## Introduction

Live Instructor Dashboard — a real-time read model that gives instructors an at-a-glance view of student progress during lectures and exams. The instructor opens `/teach/courses/:slug/live` and sees a color-coded matrix of students × problems with statuses derived from existing submission data. No new database tables are introduced; the feature is a polling-based read model over `submissions`, `group_members`, `course_problems`, and `exam_problems`.

## Glossary

- **Live_Dashboard**: The backend service function and frontend page that computes and displays the real-time student progress matrix.
- **Progress_Matrix**: A two-dimensional data structure where rows are students and columns are problems, each cell holding a status and metadata.
- **Cell_Status**: One of four values — `SOLVED`, `ATTEMPTING`, `STUCK`, `IDLE` — describing a student's current state on a specific problem.
- **Stuck_Threshold**: The configurable number of minutes (default 5) after which a student with no ACCEPTED submission and no recent activity transitions from `ATTEMPTING` to `STUCK`.
- **Instructor**: A user with role `INSTRUCTOR` or `ADMIN` who owns or administers the course.
- **Enrolled_Student**: A user who belongs to at least one group within the course.

## Requirements

### Requirement 1: Live Progress Endpoint

**User Story:** As an instructor, I want to retrieve the current progress state of all enrolled students on course problems via a single API call, so that I can display a real-time dashboard during lectures and exams.

#### Acceptance Criteria

1. WHEN an authenticated instructor requests `GET /api/courses/:slug/live`, THE Live_Dashboard SHALL return a JSON response containing the Progress_Matrix for all Enrolled_Students and all course problems.
2. WHEN the `examSlug` query parameter is provided, THE Live_Dashboard SHALL filter the Progress_Matrix to show only problems attached to that exam and only students who have at least one submission for any of those exam problems.
3. WHEN the `groupSlug` query parameter is provided, THE Live_Dashboard SHALL filter the Progress_Matrix to show only students who are members of the specified group.
4. WHEN the `stuckMinutes` query parameter is provided with a positive integer value, THE Live_Dashboard SHALL use that value as the Stuck_Threshold instead of the default 5 minutes.
5. THE Live_Dashboard SHALL compute each cell's Cell_Status using the following rules applied in order: `SOLVED` if at least one ACCEPTED submission exists; `ATTEMPTING` if submissions exist, none are ACCEPTED, and the most recent submission was created less than Stuck_Threshold minutes ago; `STUCK` if submissions exist, none are ACCEPTED, and the most recent submission was created Stuck_Threshold or more minutes ago; `IDLE` if no submissions exist for that student-problem pair.
6. THE Live_Dashboard SHALL return for each cell the `status`, `lastSubmitAt` timestamp of the most recent submission, and `attempts` count.
7. THE Live_Dashboard SHALL execute the progress computation using a single SQL query with aggregation rather than issuing per-student or per-problem queries.

### Requirement 2: Access Control

**User Story:** As a platform administrator, I want the live dashboard endpoint to enforce the same access rules as the gradebook, so that only authorized instructors can view student progress.

#### Acceptance Criteria

1. WHEN an unauthenticated user requests the live endpoint, THE Live_Dashboard SHALL respond with HTTP 401.
2. WHEN a user with role `STUDENT` requests the live endpoint, THE Live_Dashboard SHALL respond with HTTP 403.
3. WHEN an authenticated `INSTRUCTOR` who does not own the course requests the live endpoint, THE Live_Dashboard SHALL respond with HTTP 403.
4. WHEN an authenticated `ADMIN` requests the live endpoint for any course, THE Live_Dashboard SHALL respond with HTTP 200 regardless of ownership.
5. WHEN the course slug does not exist, THE Live_Dashboard SHALL respond with HTTP 404.

### Requirement 3: Frontend Matrix View

**User Story:** As an instructor, I want to see a color-coded matrix of students and problems on a dedicated page, so that I can quickly identify which students are stuck or idle during a session.

#### Acceptance Criteria

1. WHEN the instructor navigates to `/teach/courses/:slug/live`, THE Live_Dashboard SHALL render a matrix where rows represent students sorted by group then alphabetically, and columns represent problems sorted by position.
2. THE Live_Dashboard SHALL color-code each cell: green for `SOLVED`, yellow with a pulsing animation for `ATTEMPTING`, red for `STUCK`, and gray for `IDLE`.
3. THE Live_Dashboard SHALL display a header containing the course title, active exam name (if filtered), and aggregate counts of students in each status category.
4. THE Live_Dashboard SHALL automatically re-fetch the progress data every 10 seconds without requiring user interaction.
5. WHEN the instructor clicks a manual refresh button, THE Live_Dashboard SHALL immediately re-fetch the progress data regardless of the polling timer.
6. WHEN the instructor clicks on a student row, THE Live_Dashboard SHALL expand the row to show that student's submission history for each problem.
7. WHEN the instructor clicks on a specific cell, THE Live_Dashboard SHALL display the student's submissions for that specific problem.
8. THE Live_Dashboard SHALL provide filter controls: an exam selector dropdown populated from the course's exams, and a group selector dropdown populated from the course's groups.

### Requirement 4: Teach Page Integration

**User Story:** As an instructor, I want to access the live dashboard from the existing course management page, so that I can quickly switch to the live view during a session.

#### Acceptance Criteria

1. WHEN the instructor views `/teach/courses/:slug`, THE Live_Dashboard SHALL display a visible "Live" navigation element that links to `/teach/courses/:slug/live`.
2. THE Live_Dashboard SHALL render the live page within the existing teach layout shell, maintaining consistent navigation and styling.

### Requirement 5: Performance

**User Story:** As an instructor at a university with large classes, I want the dashboard to load quickly even with 100 students and 10 problems, so that the view remains responsive during exams.

#### Acceptance Criteria

1. THE Live_Dashboard SHALL compute the Progress_Matrix for 100 students × 10 problems using at most 3 SQL queries (one for students, one for problems, one for the aggregated submission matrix).
2. THE Live_Dashboard SHALL return the response within 500ms for a dataset of 100 students × 10 problems under normal database load.

### Requirement 6: No WebSocket in v1

**User Story:** As a developer, I want to use polling for the pilot version, so that the implementation remains simple and the infrastructure requirements stay minimal.

#### Acceptance Criteria

1. THE Live_Dashboard SHALL use HTTP polling at a 10-second interval as the sole mechanism for data freshness in v1.
2. THE Live_Dashboard SHALL NOT require WebSocket connections, Server-Sent Events, or any persistent connection protocol.
