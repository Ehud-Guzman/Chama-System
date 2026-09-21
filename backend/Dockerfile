# The API, in a container.
#
# This exists so that "clone it and run it" does not depend on which Node somebody has installed —
# and, more usefully, so the scratch MongoDB the rehearsal suite needs is one line away
# (docker-compose.yml) instead of a command somebody has to copy out of the README correctly.
#
#   docker compose up --build
#
# Node 20 is the floor the package declares, and 22 is what CI runs, so 22 is what this pins: a
# container on a different major from CI is a container that finds different bugs.
FROM node:22-alpine

# `tini` reaps zombies and forwards signals, which matters because the API shuts down gracefully on
# SIGTERM: without an init as PID 1, a deploy's signal never reaches node and the host kills the
# process mid-write instead.
RUN apk add --no-cache tini

WORKDIR /app

# Dependencies first, so a change to source does not reinstall the world on every build.
# `--omit=dev` because this image runs the API and its tests, not the tooling.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Runs as the unprivileged user the base image already provides. The API writes backups to disk
# (jobs/backupJob), and it should write them as somebody who cannot own the filesystem.
RUN mkdir -p /app/data/backups && chown -R node:node /app

USER node
ENV NODE_ENV=production
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/app.js"]
