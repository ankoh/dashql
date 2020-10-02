FROM i386/ubuntu
RUN apt-get update
RUN apt-get install -y \
    curl \
    build-essential \
    libssl1.0-dev \
    pkg-config \
    nodejs \
    nodejs-dev \
    node-gyp \
    npm
ARG TOOLCHAIN_VERSION
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- \
    --default-host i686-unknown-linux-gnu \
    --default-toolchain ${TOOLCHAIN_VERSION} \
    -y
ENV PATH="/root/.cargo/bin:$PATH"
WORKDIR /root
