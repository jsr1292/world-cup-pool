# Home Assistant add-on image for the World Cup Pool app.
# BUILD_FROM is supplied by build.yaml (docker.io/library/node:22-alpine).
# A default is set so a bare `docker build` (and HA's ARG validation) works too.
ARG BUILD_FROM="docker.io/library/node:22-alpine"
FROM ${BUILD_FROM}

# Which app revision to build (defaults from build.yaml args).
ARG REPO_URL="https://github.com/jsr1292/world-cup-pool"
ARG REPO_REF="master"
ARG BASHIO_VERSION="0.16.2"

# Tooling: git to fetch the app, bash+jq for bashio, curl+tar to install bashio.
# (Node + npm come from the node base image.) Guard each in case the resolved
# base already provides it (e.g. an HA base image ships bashio + jq).
RUN apk add --no-cache git bash jq curl tar tini || true

# Install bashio so run.sh can read the add-on options — skip if the base
# already has it (idempotent; -f forces the symlink if it exists).
RUN if [ ! -x /usr/bin/bashio ]; then \
      mkdir -p /tmp/bashio \
      && curl -L -s "https://github.com/hassio-addons/bashio/archive/refs/tags/v${BASHIO_VERSION}.tar.gz" \
         | tar -xzf - -C /tmp/bashio --strip-components=1 \
      && mv /tmp/bashio/lib /usr/lib/bashio \
      && ln -sf /usr/lib/bashio/bashio /usr/bin/bashio \
      && rm -rf /tmp/bashio ; \
    fi \
    && command -v node >/dev/null || (echo "ERROR: node not found in base image ${BUILD_FROM}" && exit 1)

# Fetch the application source and build the production server.
# NODE_ENV is intentionally NOT set here so devDependencies (vite/svelte/tsx)
# install for the build. Build needs no DATABASE_URL (db init is lazy).
#
# BUILD_VERSION (passed by HA as the add-on version) is referenced in the RUN
# command so a version bump CHANGES this layer's cache key — otherwise Docker
# could reuse a cached clone of old code and a Rebuild would silently ship the
# previous version. Bump the add-on version whenever app code changes.
ARG BUILD_VERSION="dev"
WORKDIR /app
RUN echo "Building world-cup-pool ${BUILD_VERSION} from ${REPO_URL}@${REPO_REF}" \
    && git clone --depth 1 --branch "${REPO_REF}" "${REPO_URL}" /app \
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
