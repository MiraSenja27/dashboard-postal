# Dashboard Postal

A fleet management dashboard for postal/logistics operations built with Node.js + Express.

## Stack

- **Backend:** Node.js with Express.js (`server.js`)
- **Frontend:** Single-page HTML/CSS/Vanilla JS (`dashboard-postal.html`)
- **Storage:** JSON file-based persistence (`data.json`)
- **File Parsing:** `xlsx` for Excel upload support
- **Auth:** In-memory user list (admin/admin123, postal/mirasenja)

## Architecture

- Express serves both the API and the static frontend from the same server on port 5000
- Frontend uses relative `/api` URLs so it works across environments without hardcoded ports
- File uploads handled by `multer`, stored temporarily in `uploads/` then deleted after parsing

## Running

```bash
node server.js
```

Server starts on port 5000 (configurable via `PORT` env var).

## Default Credentials

- Admin: `admin` / `admin123`
- Viewer: `postal` / `mirasenja`

## Key API Endpoints

- `POST /api/login` — authenticate
- `POST /api/upload` — upload volume Excel data
- `POST /api/upload-sla` — upload SLA Excel data
- `GET /api/weeks` — list available week ranges
- `GET /api/volume` — query volume data with filters

## Deployment

Configured as `autoscale` deployment. Run command: `node server.js`
