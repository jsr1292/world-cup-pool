# Home Assistant add-on image for the World Cup Pool app.
# BUILD_FROM is supplied by build.yaml (node:22-alpine, multi-arch).
ARG BUILD_FROM
FROM ${BUILD_FROM}

# Which app revision to build (defaults from build.yaml args).
ARG REPO_URL="https://github.com/jsr1292/world-cup-pool"
ARG REPO_REF="master"
ARG BASHIO_VERSION="0.16.2"

# Tooling: git to fetch the app, bash+jq for bashio, curl+tar to install bashio.
# (Node + npm come from the node base image.)
RUN apk add --no-cache git bash jq curl tar tini

# Install bashio so run.sh can read the add-on options.
RUN mkdir -p /tmp/bashio \
    && curl -L -s "https://github.com/hassio-addons/bashio/archive/refs/tags/v${BASHIO_VERSION}.tar.gz" \
       | tar -xzf - -C /tmp/bashio --strip-components=1 \
    && mv /tmp/bashio/lib /usr/lib/bashio \
    && ln -s /usr/lib/bashio/bashio /usr/bin/bashio \
    && rm -rf /tmp/bashio

# Fetch the application source and build the production server.
# NODE_ENV is intentionally NOT set here so devDependencies (vite/svelte/tsx)
# install for the build. Build needs no DATABASE_URL (db init is lazy).
WORKDIR /app
RUN git clone --depth 1 --branch "${REPO_REF}" "${REPO_URL}" /app \
    && npm ci \
    && npm run build \
    && npm cache clean --force \
    && rm -rf /app/.git

# Add-on entrypoint + DB bootstrap helper.
COPY run.sh /run.sh
COPY apply-config.mjs /app/apply-config.mjs
RUN chmod a+x /run.sh

# tini reaps any stray children; run.sh exec's node as the main process.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/run.sh"]
