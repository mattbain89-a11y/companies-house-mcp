FROM node:25-alpine AS builder

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install pnpm
RUN npm install -g pnpm

# Copy all package.json files from packages
COPY packages ./packages

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages ./packages
COPY tsconfig.json ./

# Build the TypeScript code
RUN pnpm -r build

# Production stage
FROM node:25-alpine

WORKDIR /app

# Copy package files
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install pnpm
RUN npm install -g pnpm

# Copy package.json from packages
COPY packages ./packages

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built application from builder stage
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/packages/mcp/dist ./packages/mcp/dist

# Expose port for HTTP server
EXPOSE 3000

# Set environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Start the MCP server in HTTP mode
CMD ["node", "packages/cli/dist/server/index.js", "--http", "--port", "3000"]
