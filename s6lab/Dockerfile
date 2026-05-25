FROM golang:1.24-alpine AS build
WORKDIR /src
COPY . ./
RUN go build -o /out/ncc ./cmd/cli

FROM alpine:3.20
RUN apk add --no-cache nodejs ffmpeg ca-certificates
WORKDIR /app
COPY --from=build /out/ncc /usr/local/bin/ncc
COPY s6lab/*.mjs /app/
RUN mkdir -p /work && chmod 1777 /work
ENV S6NC_WORKDIR=/work
ENV S6NC_MAX_UPLOAD_BYTES=2097152
ENV S6NC_MAX_VIDEO_BYTES=52428800
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
