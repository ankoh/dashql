pipeline {
    agent {
        docker { image 'dashql/dashql-dev:1.40.1' }
    }
    environment {
        EMSDK = '/opt/emsdk/upstream/emscripten'
    }
    stages {
        stage('Protobuf') {
            steps {
                sh 'git submodule update --init --recursive'
                sh 'mkdir -p ./build/emscripten'
                sh '${EMSDK}/emcmake cmake -S./ -B./build/emscripten -DCMAKE_BUILD_TYPE=Release'
                sh '${EMSDK}/emmake make -C./build/emscripten -j$(nproc)'
            }
        }
    }
}
