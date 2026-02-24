# 🚚 ShipmentTrackingSystem

A full-stack Shipment Tracking application built with a modern React frontend and a TypeScript/Express backend, fully containerized using Docker Compose.

---

## 📦 Tech Stack

### 🔹 Frontend (Root Level)

Built with:

* React 19
* Vite
* TypeScript
* Tailwind CSS
* React Router

Location:

```
/src
```

Development command:

```bash
npm run dev
```

Production (Docker) runs a built static version using `serve`.

---

### 🔹 Backend

Built with:

* Express
* TypeScript
* better-sqlite3 (SQLite database)
* JWT (Authentication)
* bcrypt (Password hashing)

Location:

```
/backend/src
```

Development command:

```bash
cd backend
npm run dev
```
## 🗂 Project Structure

```
ShipmentTrackingSystem/
│
├── src/                     # Frontend source
├── client.ts                # API client helper
├── package.json             # Frontend dependencies
├── vite.config.ts
├── Dockerfile               # Frontend Docker image
│
├── backend/
│   ├── src/
│   ├── routes/
│   ├── db.ts
│   ├── package.json
│   ├── Dockerfile           # Backend Docker image
│
└── docker-compose.yml       # Multi-service orchestration
```

---

## 🐳 Running with Docker (Recommended)

This project uses Docker Compose to run both frontend and backend services.

### Start the application

```bash
docker compose build --no-cache
docker compose up
```

### Services

| Service  | Port | Description                  |
| -------- | ---- | ---------------------------- |
| Frontend | 3000 | React app served via `serve` |
| Backend  | 4000 | Express API server           |

Access the app:

```
http://localhost:3000
```

Backend API:

```
http://localhost:4000/api
```

---

## 🗄 Database

* SQLite database file:

  ```
  /data/shipment.db
  ```
* Persisted using Docker volume mapping:

  ```yaml
  volumes:
    - ./data:/data
  ```

The database remains intact even if containers restart.

---

## 🔐 Authentication

* JWT-based authentication
* Token stored in `localStorage`
* Sent via:

  ```
  Authorization: Bearer <token>
  ```

---

## 🌐 Networking Overview

Browser → Frontend (localhost:3000)
Frontend → Backend (localhost:4000/api)
Backend → SQLite DB (/data/shipment.db)

---

## 🧪 Running Without Docker

### Frontend

```bash
npm install
npm run dev
```

### Backend

```bash
cd backend
npm install
npm run dev
```