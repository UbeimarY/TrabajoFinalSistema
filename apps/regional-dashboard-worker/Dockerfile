FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json tsconfig.base.json ./
COPY packages/common/package.json ./packages/common/package.json
COPY packages/common/tsconfig.json ./packages/common/tsconfig.json
COPY apps/regional-dashboard-worker/package.json ./apps/regional-dashboard-worker/package.json
COPY apps/regional-dashboard-worker/tsconfig.json ./apps/regional-dashboard-worker/tsconfig.json

RUN npm install

COPY packages/common ./packages/common
COPY apps/regional-dashboard-worker ./apps/regional-dashboard-worker

RUN npm -w @zt/common run build && npm -w @zt/regional-dashboard-worker run build

FROM node:24-alpine
WORKDIR /repo

COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules

COPY --from=build /repo/packages/common/package.json ./packages/common/package.json
COPY --from=build /repo/packages/common/dist ./packages/common/dist

COPY --from=build /repo/apps/regional-dashboard-worker/package.json ./apps/regional-dashboard-worker/package.json
COPY --from=build /repo/apps/regional-dashboard-worker/dist ./apps/regional-dashboard-worker/dist

CMD ["node", "./apps/regional-dashboard-worker/dist/index.js"]
