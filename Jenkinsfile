pipeline {
    agent {
        dockerfile {
            filename 'Dockerfile'
            dir './dev/docker/dev/'
            additionalBuildArgs '--build-arg EMSDK_VERSION=2.0.4'
        }
    }
    environment {
        EM_CACHE = '/home/jenkins/.emscripten_cache'
    }
    stages {
        stage('Core') {
            steps {
                sh 'git submodule update --init --recursive'
                sh 'mkdir -p /home/jenkins/.emscripten_cache'
                sh 'mkdir -p ./core/build/emscripten'
                sh '''#!/bin/bash
                    source /opt/env.sh
                    emsdk list
                '''
                sh '''#!/bin/bash
                    source /opt/env.sh
                    emcmake cmake -S./core/ -B./core/build/emscripten -DCMAKE_BUILD_TYPE=Release || cat ./core/build/emscripten/CMakeFiles/CMakeError.log
                '''
                sh '''#!/bin/bash
                    source /opt/env.sh
                    emmake make -C./core/build/emscripten -j$(nproc)
                '''
            }
        }
    }
}
