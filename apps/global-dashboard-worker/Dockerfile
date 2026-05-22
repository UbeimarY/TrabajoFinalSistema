FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json tsconfig.base.json ./
COPY packages/common/package.json ./packages/common/package.json
COPY packages/common/tsconfig.json ./packages/common/tsconfig.json
COPY apps/global-dashboard-worker/package.json ./apps/global-dashboard-worker/package.json
COPY apps/global-dashboard-worker/tsconfig.json ./apps/global-dashboard-worker/tsconfig.json

RUN npm install

COPY packages/common ./packages/common
COPY apps/global-dashboard-worker ./apps/global-dashboard-worker

RUN npm -w @zt/common run build && npm -w @zt/global-dashboard-worker run build

FROM node:24-alpine
WORKDIR /repo

COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules

COPY --from=build /repo/packages/common/package.json ./packages/common/package.json
COPY --from=build /repo/packages/common/dist ./packages/common/dist

COPY --from=build /repo/apps/global-dashboard-worker/package.json ./apps/global-dashboard-worker/package.json
COPY --from=build /repo/apps/global-dashboard-worker/dist ./apps/global-dashboard-worker/dist

CMD ["node", "./apps/global-dashboard-worker/dist/index.js"]
