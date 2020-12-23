FROM ubuntu:20.10

RUN apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y \
        build-essential git \
        ccache cmake ninja-build llvm clang clang-tidy curl python python3 \
        bison flex \
        brotli awscli \
        openjdk-14-jdk \
        libpthread-stubs0-dev \
        libboost-all-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

SHELL ["/bin/bash", "-c"]
RUN groupadd -g 10101 actions

ARG EMSDK_VERSION="2.0.9"
RUN mkdir -p /opt/emsdk \
    && cd /opt/emsdk \
    && curl -SL https://github.com/emscripten-core/emsdk/archive/${EMSDK_VERSION}.tar.gz | tar -xz --strip-components=1 \
    && ./emsdk install ${EMSDK_VERSION} \
    && ./emsdk activate ${EMSDK_VERSION} \
    && /bin/bash ./emsdk_env.sh \
    && rm -rf ./emscripten/tag-*/tests \
    && rm -rf ./emscripten/tag-*/site \
    && rm -rf ./emscripten/tag-*/docs \
    && rm -rf ./zips \
    && find . -name "*.o" -exec rm {} \; \
    && find . -name "*.a" -exec rm {} \; \
    && find . -name "*.tmp" -exec rm {} \;

ENV NVM_DIR=/opt/nvm
ARG NVM_VERSION="v0.37.2"
ARG NODE_VERSION="v15.2"
RUN mkdir -p /opt/nvm \
    && ls -lisah /opt/nvm \
    && curl https://raw.githubusercontent.com/creationix/nvm/${NVM_VERSION}/install.sh | bash \
    && source ${NVM_DIR}/nvm.sh \
    && nvm install ${NODE_VERSION} \
    && nvm alias default ${NODE_VERSION} \
    && nvm use default

ARG FLATBUFFER_COMMIT="338393f854eb5ba24761a22cd9316ff5cee4eab0"
RUN mkdir -p /tmp/flatbuffers/build /tmp/flatbuffers/install \
    && git clone https://github.com/google/flatbuffers /tmp/flatbuffers/repo \
    && cd /tmp/flatbuffers/repo \
    && git checkout ${FLATBUFFER_COMMIT} \
    && cmake -B /tmp/flatbuffers/build -S /tmp/flatbuffers/repo \
        -DCMAKE_CXX_STANDARD=17 \
        -DCMAKE_CXX_FLAGS=-std=c++17 \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_CXX_COMPILER=clang++ \
        -DCMAKE_C_COMPILER=clang \
        -DCMAKE_INSTALL_PREFIX=/usr/local \
        -DFLATBUFFERS_BUILD_FLATLIB=ON \
        -DFLATBUFFERS_BUILD_FLATC=ON \
        -DFLATBUFFERS_BUILD_FLATHASH=OFF \
        -DFLATBUFFERS_INSTALL=ON \
        -DFLATBUFFERS_BUILD_TESTS=OFF \
        -DFLATBUFFERS_BUILD_SHAREDLIB=OFF \
    && make -C /tmp/flatbuffers/build -j`nproc` install \
    && rm -rf /tmp/flatbuffers

ARG RUST_VERSION="1.48.0"
RUN export RUSTUP_HOME=/opt/rust \
    && export CARGO_HOME=/opt/rust \
    && curl https://sh.rustup.rs -sSf | sh -s -- --default-toolchain ${RUST_VERSION} -y \
    && export PATH=$PATH:/opt/rust/bin \
    && rustup target add wasm32-unknown-unknown \
    && chgrp -R actions /opt/rust \
    && chmod -R g=u /opt/rust

RUN source /opt/emsdk/emsdk_env.sh \
    && echo "export PATH=$PATH:/opt/rust/bin" >> /opt/env.sh \
    && echo "export EMSDK=$EMSDK" >> /opt/env.sh \
    && echo "export EM_CONFIG=$EM_CONFIG" >> /opt/env.sh \
    && echo "export EM_CACHE=/mnt/emscripten_cache/" >> /opt/env.sh \
    && echo "export EMSCRIPTEN=$EMSCRIPTEN" >> /opt/env.sh \
    && echo "export CARGO_HOME=/opt/rust" >> /opt/env.sh \
    && echo "export RUSTUP_HOME=/opt/rust" >> /opt/env.sh \
    && echo "source /opt/nvm/nvm.sh" >> /opt/env.sh \
    && printf '#!/bin/bash\n. /opt/env.sh\nexec "$@"\n' > /opt/entrypoint.sh \
    && chmod +x /opt/entrypoint.sh

ENTRYPOINT ["/opt/entrypoint.sh"]
WORKDIR /wd

