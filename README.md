# FlowForge: Distributed Workflow Engine

FlowForge is a fault-tolerant, distributed workflow engine built with TypeScript, React, PostgreSQL, and Docker. It features an AI Copilot to monitor and query system state using natural language.

## 🚀 Features
- **Exactly-Once Execution:** Uses Postgres `FOR UPDATE SKIP LOCKED` and an idempotency ledger to guarantee effects never run twice, even if a worker crashes.
- **Lease Recovery:** Background "Reaper" process detects dead workers and re-queues their tasks.
- **Chaos Tested:** A custom harness injects process kills (SIGKILL) to verify system stability (0 duplicate effects across 200 concurrent workflows).
- **Real-Time Dashboard:** React & Tailwind UI polls for live status updates.
- **AI Copilot:** Uses Groq (Llama-3) to read database context and answer questions like *"Did any steps fail today?"*

## 🛠️ Architecture
- **Frontend:** React, Vite, Tailwind CSS
- **Backend API:** Node.js, Express, JWT Auth
- **Database:** PostgreSQL 16
- **AI:** Groq SDK
- **Infrastructure:** Docker, Docker Compose

## 🏃‍♂️ Quick Start
You can run the entire 5-service architecture (API, Worker, Reaper, DB, Web) with one command:

1. Clone the repo.
2. Add your `GROQ_API_KEY` to the `environment` section of the `api` service in `docker-compose.yml`.
3. Run:
   ```bash
   docker compose up --build -d