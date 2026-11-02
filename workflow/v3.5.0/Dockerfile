FROM node:22.19.0-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci --ignore-scripts
COPY frontend ./
RUN npm run build
FROM node:22.19.0-slim AS pi
WORKDIR /opt/pi
COPY nebulae/agent_runtime/ ./
RUN npm ci --omit=dev --ignore-scripts
FROM python:3.12.12-slim-bookworm
COPY --from=pi /usr/local/bin/node /usr/local/bin/node
COPY --from=pi /opt/pi /opt/pi
WORKDIR /app
RUN pip install --no-cache-dir uv==0.9.26
COPY pyproject.toml uv.lock ./
COPY nebulae ./nebulae
COPY --from=web /nebulae/web ./nebulae/web
RUN uv sync --frozen --extra server --extra mcp --no-dev
COPY workflows/demo /opt/demo
COPY deploy/container-start.py /app/container-start.py
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1 NEBULAE_AGENT_RUNTIME=/opt/pi
EXPOSE 8765
CMD ["python", "/app/container-start.py"]
