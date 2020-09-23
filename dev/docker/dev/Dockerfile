FROM ubuntu:20.10

RUN apt-get update -qq \
    && apt-get install -y \
        build-essential git \
        cmake ninja-build clang clang-tidy curl python \
        bison flex \
        openjdk-14-jdk \
        nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ARG EMSDK_COMMIT
RUN mkdir -p /opt/emsdk \
    && cd /opt/emsdk \
    && git clone https://github.com/emscripten-core/emsdk.git . \
    && git checkout $EMSDK_COMMIT \
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
    && echo "PATH=$PATH" >> /opt/env.sh \
    && echo "EMSDK=$EMSDK" >> /opt/env.sh \
    && echo "EM_CONFIG=$EM_CONFIG" >> /opt/env.sh \
    && echo "EMSCRIPTEN=$EMSCRIPTEN" >> /opt/env.sh \
    && printf '#!/bin/bash\n. /opt/env.sh\nexec "$@"\n' > /opt/entrypoint.sh \
    && chmod +x /opt/entrypoint.sh

ENTRYPOINT ["/opt/entrypoint.sh"]
WORKDIR /wd
