pipeline {
    agent {
        dockerfile {
            filename 'Dockerfile'
            dir './dev/docker/dev/'
            additionalBuildArgs '--build-arg EMSDK_VERSION=2.0.4'
            args '-v $HOME/.emscripten_cache:/mnt/emscripten_cache'
        }
    }
    environment {
        EM_CACHE = '/mnt/emscripten_cache'
    }
    stages {
        stage('Core') {
            steps {
                sh 'git submodule update --init --recursive'
                sh 'mkdir -p ./core/build/emscripten'
                sh '''#!/bin/bash
                    source /opt/env.sh
                    emcmake cmake -S./core/ -B./core/build/emscripten -DCMAKE_BUILD_TYPE=Release
                '''
//                sh '''#!/bin/bash
//                    source /opt/env.sh
//                    emmake make -C./core/build/emscripten -j$(nproc)
//                '''
                archiveArtifacts artifacts: 'README.md', fingerprint: true
            }
        }

        stage('Deploy') {
            when {
                branch 'jenkins'
            }
            steps {
                build job: 'dashql-cd', wait: false
            }
        }
    }
}
