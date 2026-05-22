FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json tsconfig.base.json ./
COPY packages/common/package.json ./packages/common/package.json
COPY packages/common/tsconfig.json ./packages/common/tsconfig.json
COPY apps/voting-api/package.json ./apps/voting-api/package.json
COPY apps/voting-api/tsconfig.json ./apps/voting-api/tsconfig.json

RUN npm install

COPY packages/common ./packages/common
COPY apps/voting-api ./apps/voting-api

RUN npm -w @zt/common run build && npm -w @zt/voting-api run build

FROM node:24-alpine
WORKDIR /repo

COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules

COPY --from=build /repo/packages/common/package.json ./packages/common/package.json
COPY --from=build /repo/packages/common/dist ./packages/common/dist

COPY --from=build /repo/apps/voting-api/package.json ./apps/voting-api/package.json
COPY --from=build /repo/apps/voting-api/dist ./apps/voting-api/dist

CMD ["node", "./apps/voting-api/dist/index.js"]

