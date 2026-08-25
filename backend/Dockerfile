# ---------- Build stage ----------
FROM node:20-alpine AS build

# Prisma's query engine links against OpenSSL on alpine; install it up front.
RUN apk add --no-cache openssl

WORKDIR /app

# Copy the manifest and the Prisma schema BEFORE `npm ci` so @prisma/client's
# postinstall (`prisma generate`) can run during install and doesn't hit a
# chicken-and-egg with the schema being absent.
# .npmrc pins `omit=` so a build machine's injected `omit=dev` can't silently
# drop the toolchain and break `prisma generate` (same failure we hit on host).
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma

# prisma generate resolves env("DATABASE_URL") out of the schema.
ENV DATABASE_URL=postgresql://trainmate:trainmate_dev@postgres:5432/trainmate

# NOTE: do NOT set NODE_ENV=production here — npm ci honors it and silently
# omits devDependencies (@types/node, typescript, ...), which breaks the build.
# NODE_ENV=production is applied only in the runtime stage below.
RUN npm ci
# Idempotent; also protects against the postinstall being skipped.
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ---------- Runtime stage ----------
FROM node:20-alpine AS runtime

RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production

USER node

# Full node_modules on purpose: the generated Prisma client ships inside it,
# and `--omit=dev` trips @prisma/client's postinstall chicken-and-egg. Image
# size is not a concern for this dev-foundation stage; prune later in a
# production-hardening pass.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
