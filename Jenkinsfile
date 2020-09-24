pipeline {
    agent {
        dockerfile {
            filename 'Dockerfile'
            dir './dev/docker/dev/'
            additionalBuildArgs '--build-arg EMSDK_VERSION=2.0.4'
        }
    }
    environment {
        EMSDK = '/opt/emsdk/upstream/emscripten'
        EM_CACHE = '~/.emscripten_cache'
    }
    stages {
        stage('Core') {
            steps {
                sh 'git submodule update --init --recursive'
                sh 'mkdir -p ./core/build/emscripten'
                sh 'mkdir -p ./core/build/emscripten'
                sh '${EMSDK}/emcmake cmake -S./core/ -B./core/build/emscripten -DCMAKE_BUILD_TYPE=Release'
                sh '${EMSDK}/emmake make -C./core/build/emscripten -j$(nproc)'
            }
        }
    }
}
