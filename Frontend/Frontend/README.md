# SkillForge Frontend

React 19 + React Router 7 (SPA mode) + Tailwind CSS 4 + shadcn/ui.

## Quick start

Make sure the backend is running first:

```bash
cd ../../Backend/server
npm install && npm start         # → http://localhost:4000
```

Then in this folder:

```bash
npm install
npm run dev                       # → http://localhost:5173
```

Open **http://localhost:5173** to use the app.

## Scripts

| Script              | What it does                              |
| ------------------- | ----------------------------------------- |
| `npm run dev`       | Vite dev server with HMR                  |
| `npm run build`     | Production build → `build/client/`        |
| `npm start`         | Serves the built SPA on port 3000         |
| `npm run typecheck` | Generates router types & runs `tsc`       |

## Configuration

`.env.example` → copy to `.env` and override as needed.

| Var | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:4000/api` | Backend base URL |

## Deploy to Vercel

Use this folder (`Frontend/Frontend`) as the project root in Vercel.

- Build command: `npm run build`
- Output directory: `build/client`
- Environment variable: `VITE_API_URL=https://your-backend-domain/api`

`vercel.json` is included so SPA routes rewrite to `index.html`.

## Structure

```
app/
├── root.tsx                root layout, theme + auth providers
├── routes.ts               route table (React Router 7 framework mode)
├── routes/                 one .tsx per page
├── components/
│   ├── layout/AppShell.tsx   sidebar + topbar shell for authenticated routes
│   ├── brand/Logo.tsx        gradient mammoth-tusk mark
│   ├── common/               DifficultyBadge, StatusBadge, Empty, …
│   └── ui/                   shadcn/ui primitives (radix + Tailwind)
└── lib/
    ├── api.ts                fetch helper + auto refresh-token rotation
    ├── auth.tsx              AuthProvider, useAuth(), login/register/logout
    ├── theme.tsx             ThemeProvider, useTheme(), dark/light toggle
    ├── guards.tsx            <ProtectedRoute>
    ├── format.ts             timeAgo, formatNumber, status helpers
    └── types.ts              shared TS types matching the backend API
```

## First sign-in

The backend now seeds the problem catalog only. After first boot, create a real
account from the register page or configure Google OAuth.
