FROM alpine:3.23 AS download
ARG TARGETARCH
RUN apk add --no-cache ca-certificates curl
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) checksum=7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f ;; \
      arm64) checksum=5c83cd2cf151717ba0243f73e1c7802ff36e272b67144bdd7f1f7d684fd6f03d ;; \
      *) echo "Unsupported MinIO architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    release=RELEASE.2025-09-07T16-13-09Z; \
    curl -fsSL --retry 3 "https://github.com/minio/minio/releases/download/$release/minio.linux-$TARGETARCH.$release" -o /minio; \
    printf '%s  %s\n' "$checksum" /minio | sha256sum -c -; \
    chmod 0755 /minio

FROM alpine:3.23
RUN addgroup -S minio && adduser -S -G minio minio && mkdir /data && chown minio:minio /data
COPY --from=download /minio /usr/local/bin/minio
USER minio
ENTRYPOINT ["/usr/local/bin/minio"]
