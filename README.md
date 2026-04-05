# MPsan TMS - Tenant Management System

A full-stack tenant management system built for property owners and managers to track tenants, units, payments, and maintenance across multiple properties.

## Tech Stack

| Layer     | Technology                                                  |
|-----------|-------------------------------------------------------------|
| Frontend  | React 19, Vite 7, Tailwind CSS 4, Recharts                 |
| Backend   | Django 6 (DRF), Django Channels (Daphne ASGI), SimpleJWT    |
| Database  | PostgreSQL 15                                               |
| Infra     | Docker Compose, Nginx reverse proxy                         |
| ML        | scikit-learn, statsmodels (payment forecasting)             |

## Features

- Multi-property and multi-unit management with configurable layouts
- Tenant lifecycle tracking (move-in, payments, violations, move-out, blacklist)
- Payment recording with batch rent, receivables, and preferred payment day
- Real-time WebSocket notifications (Django Channels)
- Push notifications (VAPID / Web Push)
- SMS and email alerts (SMS Gateway, Gmail SMTP)
- Role-based access control (owner, manager, staff)
- Audit logging for all critical actions
- ML-powered schedule predictions
- PDF and report generation (jsPDF, html2canvas)
- PWA-ready with long-lived JWT sessions

## Prerequisites

- **Docker & Docker Compose** (recommended) *or*
- Python 3.12+, Node.js 20+, PostgreSQL 15+

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/<your-org>/MPsan-TMS.git
cd MPsan-TMS
```

### 2. Configure environment variables

```bash
cp .env.example .env
# Edit .env with your database credentials, API keys, etc.
```

### 3a. Run with Docker (recommended)

```bash
docker compose up --build
```

The app will be available at `http://localhost:8080`.

### 3b. Run locally (development)

**Backend:**

```bash
cd Backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

**Frontend:**

```bash
cd FrontEnd
npm install
npm run dev
```

## Project Structure

```
MPsan-TMS/
├── Backend/
│   ├── MPsanBackend/       # Django project settings, ASGI/WSGI config
│   ├── api/                # DRF app (models, views, serializers, consumers)
│   │   ├── management/     # Custom management commands (ML, cleanup)
│   │   └── migrations/     # Database migrations
│   ├── Dockerfile
│   └── requirements.txt
├── FrontEnd/
│   ├── src/                # React components, pages, hooks
│   ├── public/             # Static assets
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml      # Production-ready multi-service setup
├── .env.example            # Template for environment variables
└── requirements.txt        # Top-level Python dependencies reference
```

## Environment Variables

See [.env.example](.env.example) for the full list. Key variables:

| Variable               | Description                          |
|------------------------|--------------------------------------|
| `POSTGRES_DB/USER/PASSWORD` | PostgreSQL credentials          |
| `DJANGO_SECRET_KEY`    | Django secret key                    |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins      |
| `VAPID_PUBLIC_KEY`     | Web Push public key                  |
| `SMS_GATEWAY_USERNAME` | SMS gateway credentials              |
| `EMAIL_HOST_USER`      | Gmail address for notifications      |
| `REDIS_URL`            | Redis URL for WebSocket channel layer|

## License

This project is proprietary. All rights reserved.
