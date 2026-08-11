FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates procps \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.1

WORKDIR /app
