# Requirements Document

## Introduction

Multi-select problem attachment for courses and contests. Currently, the instructor UI (SyllabusPanel for courses, AttachContestProblemDialog for contests) only allows attaching one problem at a time — the instructor picks a problem, clicks "Attach", the dialog closes, and they must reopen it to add another. This feature replaces the single-select flow with a multi-select flow: the instructor checks multiple problems in the catalog list, then bulk-attaches them all in one action.

## Glossary

- **Attach_Dialog**: The modal dialog component that displays the problem catalog and allows the instructor to select and attach problems to a course or contest.
- **Problem_Catalog**: The full list of available problems fetched from `GET /api/problems?pageSize=200`, filtered to exclude already-attached problems.
- **Selection_Set**: The set of problems the instructor has checked (toggled on) in the Attach_Dialog before confirming the bulk-attach action.
- **Bulk_Attach_API**: A new backend endpoint that accepts an array of problem references and attaches them all in a single request within one transaction.
- **Course_Syllabus_Panel**: The SyllabusPanel component that manages the list of problems attached to a course.
- **Contest_Problems_Panel**: The ProblemsPanel component that manages the list of problems attached to a contest.
- **Letter_Assignment**: The A–Z letter assigned to each problem in a contest, used on standings and in the participant workspace.

## Requirements

### Requirement 1: Multi-select in Course Attach Dialog

**User Story:** As an instructor, I want to select multiple problems from the catalog at once and attach them all to a course in one action, so that I can build the syllabus faster without repeatedly opening and closing the dialog.

#### Acceptance Criteria

1. WHEN the Attach_Dialog opens for a course, THE Attach_Dialog SHALL display checkboxes next to each problem in the Problem_Catalog list, allowing the instructor to toggle problems into the Selection_Set.
2. WHEN the instructor clicks a problem row in the Attach_Dialog, THE Attach_Dialog SHALL toggle that problem in or out of the Selection_Set.
3. WHILE the Selection_Set is empty, THE Attach_Dialog SHALL disable the confirm button.
4. WHEN the instructor confirms the selection, THE Attach_Dialog SHALL attach every problem in the Selection_Set to the course by calling the Bulk_Attach_API.
5. WHEN the bulk attach completes successfully, THE Attach_Dialog SHALL close and THE Course_Syllabus_Panel SHALL refresh to display all newly attached problems.
6. THE Attach_Dialog SHALL display the count of currently selected problems on the confirm button (e.g., "Добавить (3)").
7. WHEN the instructor types in the search field, THE Attach_Dialog SHALL filter the Problem_Catalog without clearing the Selection_Set for items that are no longer visible due to filtering.

### Requirement 2: Multi-select in Contest Attach Dialog

**User Story:** As an instructor, I want to select multiple problems from the catalog at once and attach them all to a contest with auto-assigned letters, so that I can set up the problem set faster.

#### Acceptance Criteria

1. WHEN the Attach_Dialog opens for a contest, THE Attach_Dialog SHALL display checkboxes next to each problem in the Problem_Catalog list, allowing the instructor to toggle problems into the Selection_Set.
2. WHEN the instructor confirms the selection, THE Attach_Dialog SHALL attach every problem in the Selection_Set to the contest by calling the Bulk_Attach_API, with letters auto-assigned sequentially starting from the first unused letter.
3. IF the number of problems in the Selection_Set exceeds the number of available unused letters (A–Z), THEN THE Attach_Dialog SHALL display a validation error and prevent submission.
4. THE Attach_Dialog SHALL display a preview of the letter assignments (e.g., "D — problem-title, E — problem-title") before the instructor confirms.
5. WHEN the bulk attach completes successfully, THE Attach_Dialog SHALL close and THE Contest_Problems_Panel SHALL refresh to display all newly attached problems with their assigned letters.
6. THE Attach_Dialog SHALL display the count of currently selected problems on the confirm button.
7. WHEN the instructor types in the search field, THE Attach_Dialog SHALL filter the Problem_Catalog without clearing the Selection_Set for items that are no longer visible due to filtering.

### Requirement 3: Bulk Attach API for Courses

**User Story:** As a backend service, I want to accept an array of problem slugs and attach them all to a course in one transaction, so that the frontend can perform bulk operations atomically.

#### Acceptance Criteria

1. WHEN a POST request is received at `/api/courses/:slug/problems/bulk` with a body containing an array of `{ problemSlug, position? }` items, THE Bulk_Attach_API SHALL attach all specified problems to the course within a single database transaction.
2. IF any problem slug in the array does not exist in the Problem_Catalog, THEN THE Bulk_Attach_API SHALL return a 404 error identifying the invalid slug and attach none of the problems.
3. IF any problem in the array is already attached to the course, THEN THE Bulk_Attach_API SHALL skip that problem without error and attach the remaining problems.
4. THE Bulk_Attach_API SHALL require the same authorization as the existing single-attach endpoint (INSTRUCTOR or ADMIN, owner-or-ADMIN for mutation).
5. WHEN positions are not provided, THE Bulk_Attach_API SHALL assign positions sequentially starting after the current maximum position in the course syllabus.
6. THE Bulk_Attach_API SHALL accept a maximum of 26 problems per request.

### Requirement 4: Bulk Attach API for Contests

**User Story:** As a backend service, I want to accept an array of problem slugs with letter assignments and attach them all to a contest in one transaction, so that the frontend can perform bulk operations atomically.

#### Acceptance Criteria

1. WHEN a POST request is received at `/api/contests/:slug/problems/bulk` with a body containing an array of `{ problemSlug, letter }` items, THE Bulk_Attach_API SHALL attach all specified problems to the contest within a single database transaction.
2. IF any problem slug in the array does not exist in the Problem_Catalog, THEN THE Bulk_Attach_API SHALL return a 404 error identifying the invalid slug and attach none of the problems.
3. IF any letter in the array is already used by an existing contest problem, THEN THE Bulk_Attach_API SHALL return a 409 error identifying the conflicting letter and attach none of the problems.
4. IF the array contains duplicate letters, THEN THE Bulk_Attach_API SHALL return a 400 error.
5. THE Bulk_Attach_API SHALL require the same authorization as the existing single-attach endpoint (INSTRUCTOR or ADMIN, contest not yet started).
6. IF the contest has already started, THEN THE Bulk_Attach_API SHALL return a 409 error with code `CONTEST_ALREADY_STARTED`.
7. THE Bulk_Attach_API SHALL accept a maximum of 26 problems per request.

### Requirement 5: Partial Failure Feedback

**User Story:** As an instructor, I want to see clear feedback when some problems could not be attached, so that I know what succeeded and what needs attention.

#### Acceptance Criteria

1. WHEN the Bulk_Attach_API returns an error, THE Attach_Dialog SHALL display a toast notification with the error message from the server.
2. WHEN the bulk attach succeeds but some problems were skipped (already attached in courses), THE Attach_Dialog SHALL display a toast indicating how many were attached and how many were skipped.
3. IF a network error occurs during the bulk attach, THEN THE Attach_Dialog SHALL display a generic error toast and keep the dialog open with the Selection_Set intact so the instructor can retry.
