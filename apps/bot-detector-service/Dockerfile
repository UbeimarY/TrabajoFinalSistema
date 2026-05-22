FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json tsconfig.base.json ./
COPY packages/common/package.json ./packages/common/package.json
COPY packages/common/tsconfig.json ./packages/common/tsconfig.json
COPY apps/bot-detector-service/package.json ./apps/bot-detector-service/package.json
COPY apps/bot-detector-service/tsconfig.json ./apps/bot-detector-service/tsconfig.json

RUN npm install

COPY packages/common ./packages/common
COPY apps/bot-detector-service ./apps/bot-detector-service

RUN npm -w @zt/common run build && npm -w @zt/bot-detector-service run build

FROM node:24-alpine
WORKDIR /repo

COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules

COPY --from=build /repo/packages/common/package.json ./packages/common/package.json
COPY --from=build /repo/packages/common/dist ./packages/common/dist

COPY --from=build /repo/apps/bot-detector-service/package.json ./apps/bot-detector-service/package.json
COPY --from=build /repo/apps/bot-detector-service/dist ./apps/bot-detector-service/dist

CMD ["node", "./apps/bot-detector-service/dist/index.js"]
