FROM node:14.15.0-buster AS build

ENV MONGO_URL=mongodb://mongo:27017
ENV MONGO_DB=digitalstage
ENV MONGO_COLLECTION=routers
ENV AUTH_URL=http://digital-auth:5000
ENV PORT=4020

COPY package.json ./
COPY tsconfig.json ./
COPY ecosystem.config.js ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:14.15.0-buster
ENV NODE_ENV=production
COPY package.json ./
RUN npm install
COPY --from=build /dist ./dist
EXPOSE 5000
ENTRYPOINT ["node", "./dist/index.js"]
