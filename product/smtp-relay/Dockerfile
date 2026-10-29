FROM --platform=linux/amd64 node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY server.js ./
EXPOSE 8080
CMD ["node", "server.js"]
