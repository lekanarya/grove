# Grove: Log Dashboard & Transport System



---

## Table of Contents
1. [Introduction](#introduction)
2. [Features](#features)
3. [Installation](#installation)
5. [Configuration](#configuration)
6. [Log Transport](#log-transport)
7. [Dashboard Usage](#dashboard-usage)
8. [API Endpoints](#api-endpoints)
9. [Troubleshooting](#troubleshooting)
10. [Contributing](#contributing)

---

## Introduction
**Grove** is a simple log management (multiple platforms) dashboard designed to aggregate, search, and visualize logs from various sources like Apache, Nginx, system logs, PM2, Laravel, and custom logs. It uses **React** for the frontend, **Express** for the backend, and **Meilisearch** for fast log indexing and search.

---

## Features
- **Real-time Log Aggregation**: Collect logs from multiple sources.
- **Fast Search**: Powered by Meilisearch for instant log retrieval.
- **Customizable Dashboard**: Filter logs by source, time range, and keywords.
- **Log Transport**: Bash scripts and systemd services for log collection.
- **User-friendly UI**: Dark theme, interactive graphs, and log previews.

---


## Installation

### Prerequisites
- Node.js (v16+)
- Meilisearch (v1.0+)
- Bash (for log transport)
- systemd (for log transport service)

### Steps
1. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-repo/grove.git
   cd grove
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Set Up Meilisearch**:
   ```bash
   curl -L https://install.meilisearch.com | sh
   ./meilisearch --master-key="YOUR_MASTER_KEY"
   ```

4. **Configure Environment**:
   Create a `.env` file:
   ```env
   MEILI_URL=http://localhost:7700
   MEILI_API_KEY=YOUR_MASTER_KEY
   ```

5. **Start the Backend**:
   ```bash
   npm run start:backend
   ```

6. **Start the Frontend**:
   ```bash
   npm run start:frontend
   ```

7. **Set Up Log Transport**:
   - Copy the Bash script to `/usr/local/bin/grove-log-transport`.
   - Create a systemd service file at `/etc/systemd/system/grove-log-transport.service`.
   - Enable and start the service:
     ```bash
     sudo systemctl daemon-reload
     sudo systemctl enable grove-log-transport
     sudo systemctl start grove-log-transport
     ```

---

## Configuration

### Meilisearch
- Update the `MEILI_URL` and `MEILI_API_KEY` in `.env`.
- Configure Meilisearch indexes for each log type (e.g., `apache`, `nginx`).

### Log Sources
- Edit the Bash script to include paths to your log files:
  ```bash
  LOG_SOURCES=(
    "/var/log/apache2/access.log"
    "/var/log/nginx/error.log"
    "/var/log/syslog"
    "/home/user/.pm2/logs/out.log"
    "/var/www/laravel/storage/logs/laravel.log"
  )
  ```

---

## Log Transport

### Bash Script
The script tails log files and sends new entries to the Grove backend:
```bash
#!/bin/bash
while true; do
  for log in "${LOG_SOURCES[@]}"; do
    tail -n 10 "$log" | while read line; do
      curl -X POST "http://localhost:3000/api/logs" \
        -H "Content-Type: application/json" \
        -d "{\"source\":\"$(basename $log)\",\"message\":\"$line\"}"
    done
  done
  sleep 5
done
```

### systemd Service
Create `/etc/systemd/system/grove-log-transport.service`:
```ini
[Unit]
Description=Grove Log Transport Service
After=network.target

[Service]
ExecStart=/usr/local/bin/grove-log-transport
Restart=always
User=root

[Install]
WantedBy=multi-user.target
```

---

## Dashboard Usage

### Accessing the Dashboard
- Open `http://localhost:3000` in your browser.

### Features
- **Search**: Use the search bar to find logs by keyword.
- **Filters**: Filter logs by source (e.g., Apache, Nginx) or time range.
- **Graphs**: Visualize log trends over time.
- **Log Preview**: Click on a log entry to see details.

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/logs` | POST | Ingest a new log entry |
| `/api/logs` | GET | Retrieve logs (supports query parameters) |
| `/api/stats` | GET | Get log statistics (e.g., count by source) |

---

## Troubleshooting

### Common Issues
- **Meilisearch Connection**: Ensure Meilisearch is running and the API key is correct.
- **Log Transport**: Check systemd logs with `journalctl -u grove-log-transport`.
- **Dashboard Errors**: Verify the backend and frontend are running on the correct ports.

---

## Contributing
1. Fork the repository.
2. Create a feature branch.
3. Submit a pull request.

---
