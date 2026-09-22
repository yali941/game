FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json server.js tables.js records.js room-tools.js ./
RUN mkdir -p /app/data && chown node:node /app/data
COPY --chown=node:node public ./public
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
