FROM ubuntu:20.10

RUN apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y \
        build-essential git \
        ccache cmake ninja-build clang clang-tidy curl python python3 \
        bison flex \
        openjdk-14-jdk \
        libpthread-stubs0-dev \
        libboost-all-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ARG EMSDK_VERSION="2.0.4"
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

ENV NVM_DIR=/usr/local/nvm
ARG NVM_VERSION="v0.37.0"
ARG NODE_VERSION="v15.0"
RUN mkdir -p /usr/local/nvm \
    && curl https://raw.githubusercontent.com/creationix/nvm/${NVM_VERSION}/install.sh | bash \
    && source ${NVM_DIR}/nvm.sh \
    && nvm install ${NODE_VERSION} \
    && nvm alias default ${NODE_VERSION} \
    && nvm use default

RUN source /opt/emsdk/emsdk_env.sh \
    && echo "PATH=$PATH" >> /opt/env.sh \
    && echo "EMSDK=$EMSDK" >> /opt/env.sh \
    && echo "EM_CONFIG=$EM_CONFIG" >> /opt/env.sh \
    && echo "EM_CACHE=/mnt/emscripten_cache/" >> /opt/env.sh \
    && echo "EMSCRIPTEN=$EMSCRIPTEN" >> /opt/env.sh \
    && echo "source /usr/local/nvm/nvm.sh" >> /opt/env.sh \
    && printf '#!/bin/bash\n. /opt/env.sh\nexec "$@"\n' > /opt/entrypoint.sh \
    && chmod +x /opt/entrypoint.sh

ENTRYPOINT ["/opt/entrypoint.sh"]
WORKDIR /wd

