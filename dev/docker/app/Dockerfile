FROM nginx:alpine

COPY ./app/build /usr/share/nginx/html
COPY ./dev/docker/app/nginx.conf /etc/nginx/nginx.conf
COPY ./dev/docker/app/mime.types /etc/nginx/mime.types
