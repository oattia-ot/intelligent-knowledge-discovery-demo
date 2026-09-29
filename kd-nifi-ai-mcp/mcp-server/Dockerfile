# Official Cloudera nifi-mcp-server (git+https://github.com/cloudera/nifi-mcp-server.git)
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY entrypoint.py /app/entrypoint.py
COPY nifi_client.py /app/nifi_client.py
COPY app.py /app/app.py
COPY server.py /app/server.py
COPY kd_server.py /app/kd_server.py
COPY tools /app/tools
COPY nar /app/nar
COPY kd /app/kd

ENV PYTHONUNBUFFERED=1
ENV MCP_TRANSPORT=sse
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8000
ENV FASTMCP_HOST=0.0.0.0
ENV FASTMCP_PORT=8000
ENV NIFI_READONLY=false
EXPOSE 8000

CMD ["python", "-u", "/app/entrypoint.py"]
