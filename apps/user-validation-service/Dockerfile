FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json tsconfig.base.json ./
COPY packages/common/package.json ./packages/common/package.json
COPY packages/common/tsconfig.json ./packages/common/tsconfig.json
COPY apps/user-validation-service/package.json ./apps/user-validation-service/package.json
COPY apps/user-validation-service/tsconfig.json ./apps/user-validation-service/tsconfig.json

RUN npm install

COPY packages/common ./packages/common
COPY apps/user-validation-service ./apps/user-validation-service

RUN npm -w @zt/common run build && npm -w @zt/user-validation-service run build

FROM node:24-alpine
WORKDIR /repo

COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules

COPY --from=build /repo/packages/common/package.json ./packages/common/package.json
COPY --from=build /repo/packages/common/dist ./packages/common/dist

COPY --from=build /repo/apps/user-validation-service/package.json ./apps/user-validation-service/package.json
COPY --from=build /repo/apps/user-validation-service/dist ./apps/user-validation-service/dist

CMD ["node", "./apps/user-validation-service/dist/index.js"]

