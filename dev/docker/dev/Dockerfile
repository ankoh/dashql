FROM ubuntu:20.04

RUN apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y \
        build-essential git \
        cmake ninja-build clang clang-tidy curl python \
        bison flex \
        openjdk-14-jdk \
        nodejs \
        libpthread-stubs0-dev \
        libboost-all-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ARG EMSDK_VERSION
RUN mkdir -p /opt/emsdk \
    && cd /opt/emsdk \
    && curl -SL https://github.com/emscripten-core/emsdk/archive/${EMSDK_VERSION}.tar.gz | tar -xz --strip-components=1 \
    && ./emsdk install latest \
    && ./emsdk activate latest \
    && /bin/bash ./emsdk_env.sh \
    && rm -rf ./emscripten/tag-*/tests \
    && rm -rf ./emscripten/tag-*/site \
    && rm -rf ./emscripten/tag-*/docs \
    && rm -rf ./zips \
    && find . -name "*.o" -exec rm {} \; \
    && find . -name "*.a" -exec rm {} \; \
    && find . -name "*.tmp" -exec rm {} \;

SHELL ["/bin/bash", "-c"]
RUN source /opt/emsdk/emsdk_env.sh \
    && echo "export PATH=$PATH" >> /opt/env.sh \
    && echo "export EMSDK=$EMSDK" >> /opt/env.sh \
    && echo "export EM_CONFIG=$EM_CONFIG" >> /opt/env.sh \
    && echo "export EMSCRIPTEN=$EMSCRIPTEN" >> /opt/env.sh \
    && printf '#!/bin/bash\nsource /opt/env.sh\nexec "$@"\n' > /opt/entrypoint.sh \
    && chmod +x /opt/entrypoint.sh

ENTRYPOINT ["/opt/entrypoint.sh"]
WORKDIR /wd
