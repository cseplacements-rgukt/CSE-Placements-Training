# MOD-U-GO — Placement Training & Online Examination Platform

An online examination platform with a Node.js backend and React frontend. Includes Firebase authentication, exam scheduling with publish/close lifecycle and join codes, a question bank, AI-assisted answer grading, an AI proctoring engine (gaze + face tracking), notifications, reports, and role-based access control.

## Roles

The platform has four roles (`backend/models/User.js`):

| Role | Description | Can do |
|---|---|---|
| `student` | Default role on signup | Take exams, view own submissions/results |
| `tnpc_admin` | Instructor / exam conductor (formerly `teacher`) | Create/publish/close exams, question bank, view & review submissions, broadcast notifications |
| `proctor` | Exam proctor | View flagged proctoring sessions, review submissions |
| `admin` | Super administrator | Everything above plus user management, role changes, platform health/settings via `/admin` |

**How roles are assigned**

- Public signup only accepts `student` or `tnpc_admin` (`backend/routes/auth.js`).
- `proctor` and `admin` can **only** be granted by an existing `admin` (via the Admin Dashboard → Users tab, `PUT /api/admin/users/:id`) or by the local bootstrap script:

  ```bash
  cd backend
  node scripts/promote-user-role.js <email> <student|tnpc_admin|proctor|admin>
  ```

  Since no seed creates the first `admin`, this script (or a direct MongoDB update) is mandatory before anyone can manage roles through the UI.
- Legacy accounts with role `teacher` are automatically treated as `tnpc_admin`.

## Features

### For Students
- Take scheduled exams (MCQ, short answer, fill-in-the-blank)
- Join exams via exam code
- Auto-save of answers during the exam
- Anti-cheating measures:
  - Enforced fullscreen mode
  - Tab-switch / fullscreen-exit detection and violation recording
  - AI proctoring: webcam-based gaze tracking (WebGazer) and face detection (face-api.js) feed proctoring sessions/events
- Automatic grading with instant scores; view past submissions

### For Instructors (`tnpc_admin`)
- Create, edit, publish, close, and delete exams
- Question bank with import support
- Review all student submissions with scores, answers, and violation counts
- Override AI grades or trigger regrades
- Broadcast notifications

### For Admins
- Admin dashboard at `/admin`: manage users, change any user's role, delete users/exams, view platform settings and health
- Reports and dashboard statistics
- Urgent alerts on suspicious login activity

### AI Grading
- Short-answer questions are auto-graded asynchronously by an SLM (Groq API, model configurable via env) using a Bull/Redis job queue
- Manual grade override and regrade endpoints for instructors

## Tech Stack

### Backend
- Node.js + Express
- MongoDB (Mongoose)
- Firebase Admin SDK for authentication
- Bull + ioredis for the grading queue (Redis optional — the app still runs without it; queue init is non-blocking)
- Groq SLM API for AI grading
- express-rate-limit
- Jest + Supertest + mongodb-memory-server for tests

### Frontend
- React 19 with Vite (rolldown-vite)
- React Router v7
- Firebase JS SDK for authentication
- Axios for API calls
- WebGazer + face-api.js for client-side proctoring
- Vitest / Testing Library

## Project Structure

```
├── backend/
│   ├── config/
│   │   ├── db.js               # MongoDB connection
│   │   └── firebase.js         # Firebase Admin setup
│   ├── middleware/
│   │   ├── auth.js             # Firebase token verification
│   │   └── rateLimiter.js      # Per-user / per-IP rate limiters
│   ├── models/                 # User, Exam, Submission, Question,
│   │                           # Notification, ProctoringSession, Report,
│   │                           # LoginAttempt, RegistrationAttempt, Classroom*
│   ├── routes/
│   │   ├── auth.js             # Register/login/profile, 2FA, lockouts
│   │   ├── exams.js            # Exam CRUD, publish/close, join codes, questions
│   │   ├── submissions.js      # Start/auto-save/submit/review/unlock
│   │   ├── grading.js          # AI grading status, overrides, regrade
│   │   ├── proctoring.js       # Sessions, events, flagged review, calibration
│   │   ├── questions.js        # Question bank CRUD + import (admin)
│   │   ├── notifications.js    # User notifications + broadcast
│   │   ├── reports.js          # Report generation & stats
│   │   └── admin.js            # User/exam management, settings, health
│   ├── services/
│   │   ├── autoGrader.js       # SLM-powered answer grading
│   │   └── gradingQueue.js     # Bull queue initialization
│   ├── scripts/
│   │   └── promote-user-role.js # Bootstrap/promote any account's role
│   ├── tests/                  # Jest test suite
│   └── server.js               # Express app (API v2.0.0)
│
└── frontend/
    └── src/
        ├── config/firebase.js  # Firebase client config
        ├── contexts/AuthContext.jsx
        ├── services/examService.js
        ├── components/         # Navbar etc.
        ├── pages/
        │   ├── Login.jsx / Signup.jsx
        │   ├── Dashboard.jsx
        │   ├── CreateExam.jsx      # create/edit exams
        │   ├── QuestionBank.jsx
        │   ├── TakeExam.jsx
        │   ├── MySubmissions.jsx
        │   ├── ExamSubmissions.jsx # instructor/proctor review view
        │   └── AdminDashboard.jsx  # admin-only user/exam management
        └── App.jsx             # Routes + RoleRoute guards
```

\* The Classrooms feature has been removed — its route/model files are retained for reference only.

## Setup Instructions

### Prerequisites
- Node.js (v18+ recommended)
- MongoDB (local or cloud)
- Redis (optional — needed only if you want async AI grading)
- A Firebase project with Authentication (Email/Password) enabled
- A Groq API key (optional — enables AI grading of short answers)

### Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# edit .env with your values
npm run dev     # development (nodemon)
npm start       # production
```

Backend runs on `http://localhost:5000`. Health check: `GET /health`.

Environment variables (see `backend/.env.example`):

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/mod-u-go
REDIS_URL=redis://localhost:6379              # optional (grading queue)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-client-email@project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FRONTEND_URL=http://localhost:5173            # CORS allowlist (comma-separated ok)
SLM_API_URL=https://api.groq.com/openai/v1/chat/completions
SLM_API_KEY=your-slm-api-key                  # optional (AI grading)
SLM_MODEL_NAME=llama-3.1-8b-instant
SLM_TIMEOUT_MS=30000
```

CORS allows any `http://localhost:*` origin plus the origins listed in `FRONTEND_URL`.

### Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env
# edit .env with your values
npm run dev
```

Frontend runs on `http://localhost:5173`. Other scripts: `npm run build`, `npm run preview`, `npm run lint`.

Environment variables:

```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-auth-domain
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-storage-bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
VITE_FIREBASE_APP_ID=your-app-id
VITE_API_URL=http://localhost:5000/api
```

> Note: `.env.example` only ships `VITE_API_URL`; you must add the `VITE_FIREBASE_*`
> values yourself (Firebase Console → Project Settings → Your apps).

### Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Enable Authentication → Email/Password
3. Frontend config: Project Settings → General → Your apps (web app)
4. Backend service account: Project Settings → Service Accounts → Generate new private key

### Creating the First Admin

1. Sign up normally in the UI (choose *Student* or *TNPC Admin*).
2. Promote yourself from the machine running MongoDB:

   ```bash
   cd backend
   node scripts/promote-user-role.js your@email.com admin
   ```

3. Log in again selecting the **TNPC Admin** option in the login dropdown (there is no separate "Admin" option — the guard only rejects students). The `/admin` sidebar link will now appear.

## App Routes & Access Control

| Route | Allowed roles |
|---|---|
| `/login`, `/signup` | public |
| `/dashboard` | any authenticated user |
| `/create-exam`, `/edit-exam/:examId`, `/question-bank` | `tnpc_admin`, `admin` |
| `/take-exam/:examId`, `/my-submissions` | `student` |
| `/exam-submissions/:examId` | `tnpc_admin`, `admin`, `proctor` |
| `/admin` | `admin` |

## API Endpoints

Base URL: `/api`

### Auth (`/auth`)
- `POST /register` — register/login (role limited to `student`/`tnpc_admin`)
- `GET /me` — current profile
- `PUT /profile` — update name/avatar/reference image
- `POST /2fa/enable` · `POST /2fa/verify` · `POST /2fa/validate` · `POST /2fa/disable` · `GET /2fa/status`
- `POST /check-registration` — registration-attempt lock status
- `POST /login-status` · `POST /login-failure` · `POST /login-success` — login lockout tracking

### Exams (`/exams`)
- `POST /` create · `GET /` list (role-filtered) · `GET /:id`
- `PUT /:id` · `DELETE /:id` (owner/admin)
- `PUT /:id/publish` · `PUT /:id/close` (lifecycle)
- `POST /join` — join by exam code (rate-limited)
- `POST /:examId/questions` · `PUT /:examId/questions/:qid` · `DELETE /:examId/questions/:qid`

### Submissions (`/submissions`)
- `POST /start` — start attempt · `POST /auto-save` · `POST /` submit (rate-limited)
- `GET /exam/:examId` (instructor/proctor) · `GET /my-submissions` · `GET /:id`
- `PUT /:id/review` (manual grading/publishing) · `PUT /:id/unlock`

### Grading (`/grading`)
- `GET /:submissionId/status` — AI grading progress
- `PUT /:submissionId/override` · `PUT /:submissionId/override-total`
- `POST /:submissionId/regrade`

### Proctoring (`/proctoring`)
- `POST /start` · `POST /event` · `POST /events/batch` · `POST /end`
- `POST /:id/calibrate`
- `GET /active` · `GET /flagged` · `GET /:id` · `GET /by-submission/:submissionId`
- `PUT /:id/review` (proctor/admin)

### Question Bank (`/questions`) — admin only
- CRUD + `POST /import`

### Notifications (`/notifications`)
- `GET /` · `PUT /:id/read` · `PUT /read-all` · `DELETE /:id`
- `POST /broadcast` (admin/tnpc_admin/proctor)

### Reports (`/reports`)
- `POST /generate` · `GET /` · `GET /stats/dashboard` · `GET /:id` · `DELETE /:id`

### Admin (`/admin`) — `admin` role only
- `GET /users` · `PUT /users/:id` (change role/status) · `DELETE /users/:id`
- `GET /exams` · `DELETE /exams/:id`
- `GET /settings` · `GET /health`

## Security

- All data routes protected by Firebase ID-token verification
- No self-service privilege escalation: registration ignores unauthorized roles; only `requireAdmin` endpoints may change roles
- Login lockout: account locks for 15 min after 5 consecutive failed logins; >10 failures/hour raises urgent notifications to admins
- Registration limited to 3 attempts per email per 24 h
- Rate limits (per authenticated user unless noted):
  - Auth routes: 5 requests / 15 min per IP
  - Exam submission: 5 / hour · auto-save: 12 / min
  - Proctoring events: 30 / min · exam-code joins: 10 / min
- Correct answers are stripped from exam payloads returned to students
- Proctoring uploads store metadata only (1 MB body cap)
- Environment variables must never be committed; use HTTPS in production

## Testing

```bash
cd backend
npm test          # Jest + Supertest against in-memory MongoDB
npm test tests/admin.test.js   # single suite
```

## License

MIT License

## Contributing

Contributions are welcome! Please submit a Pull Request.
