pipeline {
    agent {
        dockerfile {
            filename 'Dockerfile'
            dir './dev/docker/dev/'
            additionalBuildArgs '--build-arg EMSDK_VERSION=2.0.4'
        }
    }
    environment {
        PATH = '/opt/emsdk/upstream/emscripten:${env.PATH}'
        EMSDK = '/opt/emsdk'
        EM_CACHE = '~/.emscripten_cache'
        EM_UPSTREAM = '/opt/emsdk/upstream/emscripten'
    }
    stages {
        stage('Core') {
            steps {
                sh 'git submodule update --init --recursive'
                sh 'mkdir -p ./core/build/emscripten'
                sh 'mkdir -p ./core/build/emscripten'
                sh '${EM_UPSTREAM}/emcmake cmake -S./core/ -B./core/build/emscripten -DCMAKE_BUILD_TYPE=Release'
                sh '${EM_UPSTREAM}/emmake make -C./core/build/emscripten -j$(nproc)'
            }
        }
    }
}
