# ボランティア用ミラーイメージ。起動時にカタログをミラー（取得・検証）してから配信する。
# 使い方の例:
#   git clone <catalog-repo> ./catalog-src
#   docker run -e ORIGIN=https://mirror.example.org -e PORT=6969 \
#     -v $PWD/catalog-src:/catalog-src bitlazarus/mirror
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV ORIGIN=http://localhost:6969 PORT=6969 SRC_CATALOG=/catalog-src
# ミラーで取得・検証してから、審査を通ったものだけを配信する（fail-closed）。
CMD ["sh", "-c", "node bin/blz.mjs mirror \"$SRC_CATALOG\" --origin \"$ORIGIN\" --catalog /app/catalog --data /app/data && node bin/blz.mjs seed --port \"$PORT\" --catalog /app/catalog --data /app/data"]
