FROM nginx:alpine

COPY ./tigon-app/build /usr/share/nginx/html
