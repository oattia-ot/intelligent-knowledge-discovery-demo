FROM nginx:alpine
RUN apk add --no-cache openssl
COPY nginx.conf.template /tmp/nginx.conf.template
COPY nifi-proxy-locations.conf.template /tmp/nifi-proxy-locations.conf.template
COPY nifi-unreach.html.template /tmp/nifi-unreach.html.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
EXPOSE 8080 8443
ENTRYPOINT ["/docker-entrypoint.sh"]
