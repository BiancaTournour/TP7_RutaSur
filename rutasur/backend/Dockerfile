FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production KAFKAJS_NO_PARTITIONER_WARNING=1
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
CMD ["node", "src/simulator/index.js"]
