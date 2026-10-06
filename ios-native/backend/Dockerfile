FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 BISIK_DATABASE_PATH=/app/data/bisik.sqlite3 BISIK_TEMP_DIRECTORY=/tmp
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 bisik
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY bisik ./bisik
COPY app.py .
RUN mkdir -p data && chown -R bisik:bisik /app
USER bisik
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--limit-concurrency", "16", "--no-access-log"]
