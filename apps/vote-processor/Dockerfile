FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json tsconfig.base.json ./
COPY packages/common/package.json ./packages/common/package.json
COPY packages/common/tsconfig.json ./packages/common/tsconfig.json
COPY apps/vote-processor/package.json ./apps/vote-processor/package.json
COPY apps/vote-processor/tsconfig.json ./apps/vote-processor/tsconfig.json

RUN npm install

COPY packages/common ./packages/common
COPY apps/vote-processor ./apps/vote-processor

RUN npm -w @zt/common run build && npm -w @zt/vote-processor run build

FROM node:24-alpine
WORKDIR /repo

COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules

COPY --from=build /repo/packages/common/package.json ./packages/common/package.json
COPY --from=build /repo/packages/common/dist ./packages/common/dist

COPY --from=build /repo/apps/vote-processor/package.json ./apps/vote-processor/package.json
COPY --from=build /repo/apps/vote-processor/dist ./apps/vote-processor/dist

CMD ["node", "./apps/vote-processor/dist/index.js"]
