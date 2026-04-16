FROM node:20-alpine

WORKDIR /app

# Копируем файлы зависимостей отдельно (кеширование слоёв)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Копируем исходный код
COPY src/ ./src/

# Amvera использует PORT из переменных окружения
ENV PORT=8080
EXPOSE 8080

# Healthcheck для Amvera / Docker
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

USER node

CMD ["node", "src/index.js"]
