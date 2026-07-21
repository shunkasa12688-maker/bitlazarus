# Volunteer mirror image. On startup it mirrors the catalog (fetch + verify) before serving.
# Example usage:
#   git clone <catalog-repo> ./catalog-src
#   docker run -e ORIGIN=https://mirror.example.org -e PORT=6969 \
#     -v $PWD/catalog-src:/catalog-src bitlazarus/mirror
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV ORIGIN=http://localhost:6969 PORT=6969 SRC_CATALOG=/catalog-src
# Mirror (fetch + verify) first, then serve only the items that passed screening (fail-closed).
CMD ["sh", "-c", "node bin/blz.mjs mirror \"$SRC_CATALOG\" --origin \"$ORIGIN\" --catalog /app/catalog --data /app/data && node bin/blz.mjs seed --port \"$PORT\" --catalog /app/catalog --data /app/data"]
