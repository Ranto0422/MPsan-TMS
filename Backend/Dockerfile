# ---------- Build stage: install deps into a venv ----------
FROM python:3.13-slim AS builder

WORKDIR /app

# System deps for psycopg2-binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

# ---------- Runtime stage: slim image, no build tools ----------
FROM python:3.13-slim AS runtime

# Only runtime lib for psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 && rm -rf /var/lib/apt/lists/*

# Copy venv from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Create non-root user
RUN adduser --disabled-password --no-create-home --gecos "" appuser

# Copy application code (media excluded via .dockerignore)
COPY . .

# Collect static files (admin CSS etc.) at build time
RUN DJANGO_SECRET_KEY=build-placeholder POSTGRES_DB=x POSTGRES_USER=x POSTGRES_PASSWORD=x \
    python manage.py collectstatic --noinput 2>/dev/null || true

# Own the dirs that need to be writable at runtime
RUN mkdir -p /app/media /app/staticfiles /app/api/ml/models && chown -R appuser:appuser /app/media /app/staticfiles /app/api/ml

USER appuser

EXPOSE 8000

CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "MPsanBackend.asgi:application"]
