FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home --uid 10001 mixora
COPY . .
RUN mkdir -p /data && chown mixora:mixora /data
USER mixora
ENV MIXORA_DATA=/data
EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2", "--timeout", "120", "--access-logfile", "-", "server:application"]
