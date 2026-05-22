FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json tsconfig.base.json ./
COPY packages/common/package.json ./packages/common/package.json
COPY packages/common/tsconfig.json ./packages/common/tsconfig.json
COPY apps/voter-registration-service/package.json ./apps/voter-registration-service/package.json
COPY apps/voter-registration-service/tsconfig.json ./apps/voter-registration-service/tsconfig.json

RUN npm install

COPY packages/common ./packages/common
COPY apps/voter-registration-service ./apps/voter-registration-service

RUN npm -w @zt/common run build && npm -w @zt/voter-registration-service run build

FROM node:24-alpine
WORKDIR /repo

COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules

COPY --from=build /repo/packages/common/package.json ./packages/common/package.json
COPY --from=build /repo/packages/common/dist ./packages/common/dist

COPY --from=build /repo/apps/voter-registration-service/package.json ./apps/voter-registration-service/package.json
COPY --from=build /repo/apps/voter-registration-service/dist ./apps/voter-registration-service/dist

CMD ["node", "./apps/voter-registration-service/dist/index.js"]

