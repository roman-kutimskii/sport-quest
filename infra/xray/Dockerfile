FROM alpine:3.23 AS download
RUN apk add --no-cache ca-certificates curl unzip
ARG XRAY_VERSION=26.10.21
ARG XRAY_SHA256=0eec3ed4163c273d8c8bf821f7d219e257921cf584aa3fb970715e458e631978
RUN curl -fsSL --retry 3 "https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VERSION}/Xray-linux-64.zip" -o /tmp/xray.zip \
    && echo "${XRAY_SHA256}  /tmp/xray.zip" | sha256sum -c - \
    && unzip /tmp/xray.zip xray -d /out

FROM alpine:3.23
RUN apk add --no-cache ca-certificates curl jq
COPY --from=download /out/xray /usr/local/bin/xray
COPY entrypoint.sh /usr/local/bin/xray-entrypoint
RUN chmod 755 /usr/local/bin/xray /usr/local/bin/xray-entrypoint
USER 10000:10000
ENTRYPOINT ["/usr/local/bin/xray-entrypoint"]
