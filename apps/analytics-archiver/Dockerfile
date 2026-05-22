FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json tsconfig.base.json ./
COPY packages/common/package.json ./packages/common/package.json
COPY packages/common/tsconfig.json ./packages/common/tsconfig.json
COPY apps/analytics-archiver/package.json ./apps/analytics-archiver/package.json
COPY apps/analytics-archiver/tsconfig.json ./apps/analytics-archiver/tsconfig.json

RUN npm install

COPY packages/common ./packages/common
COPY apps/analytics-archiver ./apps/analytics-archiver

RUN npm -w @zt/common run build && npm -w @zt/analytics-archiver run build

FROM node:24-alpine
WORKDIR /repo

COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules

COPY --from=build /repo/packages/common/package.json ./packages/common/package.json
COPY --from=build /repo/packages/common/dist ./packages/common/dist

COPY --from=build /repo/apps/analytics-archiver/package.json ./apps/analytics-archiver/package.json
COPY --from=build /repo/apps/analytics-archiver/dist ./apps/analytics-archiver/dist

CMD ["node", "./apps/analytics-archiver/dist/index.js"]
