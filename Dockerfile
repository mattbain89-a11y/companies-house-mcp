FROM node:25-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy config files
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# Copy packages
COPY packages ./packages

# Install dependencies with build scripts disabled initially
# Then rebuild with scripts enabled for specific packages
RUN pnpm install --frozen-lockfile --ignore-scripts

# Now rebuild esbuild binaries manually
RUN pnpm -r --filter "@modelcontextprotocol/sdk" rebuild || true

# Build TypeScript
RUN pnpm -r build

# Production stage
FROM node:25-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy config files
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy packages
COPY packages ./packages

# Install production dependencies with scripts disabled
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built code from builder
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/packages/mcp/dist ./packages/mcp/dist

# Expose port
EXPOSE 3000

# Set environment variables for memory optimization
ENV PORT=3000 \
    NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=256 --expose-gc"

# Start MCP server in HTTP mode
CMD ["node", "packages/cli/dist/server/index.js", "--http", "--port", "3000"]
