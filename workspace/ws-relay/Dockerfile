# Klein & schnell
FROM node:20-alpine

WORKDIR /app
COPY package.json ./
# Use npm install instead of npm ci as there is no package-lock.json
RUN npm install --omit=dev

COPY server.js ./

# Cloud Run übergibt PORT
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
