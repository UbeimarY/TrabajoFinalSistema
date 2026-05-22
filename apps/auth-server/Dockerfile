FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json tsconfig.base.json ./
COPY apps/auth-server/package.json ./apps/auth-server/package.json

RUN npm install

COPY apps/auth-server ./apps/auth-server

RUN npm -w @zt/auth-server run build

FROM node:24-alpine
WORKDIR /app

COPY --from=build /repo/apps/auth-server/package.json ./package.json
COPY --from=build /repo/apps/auth-server/dist ./dist

RUN npm install --omit=dev

CMD ["node", "./dist/index.js"]

