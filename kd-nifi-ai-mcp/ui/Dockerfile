FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html.template
COPY embed.js embed-example.html /usr/share/nginx/html/
COPY nginx.conf.template /tmp/nginx.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
