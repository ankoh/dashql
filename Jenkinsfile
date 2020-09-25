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
    options {
        copyArtifactPermission('dashql-cd');
    }
    stages {
        stage('Configure') {
            steps {
                sh 'git submodule update --init --recursive'
                sh 'mkdir -p ./core/build/emscripten'
            }
        }

        stage('Build') {
            parallel wasm {
                steps {
                    sh '''#!/bin/bash
                        source /opt/env.sh
                        emcmake cmake -S./core/ -B./core/build/emscripten -DCMAKE_BUILD_TYPE=Release
                    '''
//                  sh '''#!/bin/bash
//                    source /opt/env.sh
//                    emmake make -C./core/build/emscripten -j$(nproc)
//                  '''
                    archiveArtifacts artifacts: 'README.md', fingerprint: true
                }
            }, app {
                sh 'npm stuff'

            }, failFast: true
        }

        stage('Deploy') {
            when {
                anyOf {
                    branch 'master'
                    branch 'stable'
                    branch 'testing'
                }
            }
            steps {
                build job: 'dashql-cd', wait: false, parameters: [
                    string(name: 'UPSTREAM_BRANCH', value: env.BRANCH_NAME)
                ]
            }
        }
    }
}
