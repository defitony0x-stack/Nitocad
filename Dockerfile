# Pinned Python 3.11 - OCP's pip wheels only cover 3.9-3.12 (confirmed
# against PyPI/CadQuery docs as of 2026-07-31), and Railway's Nixpacks
# builder has repeatedly failed to honor .python-version/runtime.txt
# pins in practice (multiple open reports on Railway's own help forum),
# defaulting to whatever its current Nix snapshot ships. A Dockerfile
# sidesteps that guesswork entirely - this is the fix for the
# Railway/Vercel deployment crashes you were hitting before.
FROM python:3.11-slim

WORKDIR /app

# libGL.so.1 and friends: OCP's wheel links against OpenGL/X11 libraries
# that python:3.11-slim doesn't ship. Without these, `import cadquery`
# fails at import time with "ImportError: libGL.so.1: cannot open shared
# object file" - a known, repeatedly-reported CadQuery/Docker issue.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libxrender1 \
    libsm6 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

# Railway's ephemeral filesystem wipes ./output and the sqlite file on
# every redeploy/restart - see storage.py and db.py's DB_PATH note.
# Mount a persistent volume at /data and set DB_PATH=/data/nl_to_cad.db
# (and configure R2 for generated files) before relying on this in
# production.
ENV PORT=8000
EXPOSE 8000

# --proxy-headers + --forwarded-allow-ips="*": Railway terminates TLS at
# its edge (railway-hikari) and forwards plain HTTP to this container.
# Without these flags uvicorn takes the raw connection's scheme (http) as
# truth instead of reading X-Forwarded-Proto, so any URL it builds itself -
# e.g. Starlette's trailing-slash redirect on POST /mcp -> /mcp/ - comes
# back as an http:// Location header even though the deploy is https-only.
# "*" is safe here specifically because Railway's own edge is the only
# thing that can reach this container's PORT (see .dockerignore/network
# posture in README) - it is not exposed directly to the open internet.
CMD ["sh", "-c", "uvicorn web_app:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips=*"]
