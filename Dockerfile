FROM node:25-alpine AS builder

WORKDIR /app

# Install pnpm first
RUN npm install -g pnpm

# Copy all config files
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# Copy packages directory structure
COPY packages ./packages

# Install all dependencies (including dev) with approve-builds to allow build scripts
RUN pnpm install --frozen-lockfile

# Build the TypeScript code
RUN pnpm -r build

# Production stage
FROM node:25-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy all config files
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy packages directory
COPY packages ./packages

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/packages/mcp/dist ./packages/mcp/dist

# Expose port for HTTP server
EXPOSE 3000

# Set environment variables for memory optimization
ENV PORT=3000 \
    NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=256 --expose-gc"

# Start the MCP server in HTTP mode with memory optimization
CMD ["node", "packages/cli/dist/server/index.js", "--http", "--port", "3000"]
