pipeline {
    agent {
        dockerfile {
            filename 'Dockerfile'
            dir './dev/docker/dev/'
            additionalBuildArgs '--build-arg EMSDK_VERSION=2.0.4'
            args '-v $HOME/.emscripten_cache:/mnt/emscripten_cache -v $HOME/.npm_cache:/mnt/npm_cache -v $HOME/.ccache:/mnt/ccache'
        }
    }

    environment {
        EM_CACHE = '/mnt/emscripten_cache'
        NPM_CACHE = '/mnt/npm_cache'
        CCACHE_DIR = '/mnt/ccache'
//        CCACHE_BASEDIR = '${WORKSPACE}'
    }

    options {
        copyArtifactPermission('dashql-cd');
    }

    stages {
        stage('Configure') {
            steps {
                sh 'chown -R "${env.BUILD_USER_ID}" /mnt/npm_cache /mnt/ccache /mnt/emscripten_cache'
                sh 'git submodule update --init --recursive'
                sh 'mkdir -p ./core/build/emscripten ./core/build/debug ./core/build/release'
            }
        }

        stage('Debug/Build') {
            steps {
                sh 'cmake -S./core/ -B./core/build/debug -DCMAKE_BUILD_TYPE=Debug -DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_BUILD_TYPE=Debug'
                sh 'make -C./core/build/debug -j$(nproc)'
            }
        }

        stage('Debug/Test') {
            steps {
                sh 'echo "test debug"'
            }
        }

        stage('App/Emscripten') {
            steps {
                sh '''#!/bin/bash
                    source /opt/env.sh
                    emcmake cmake -S./core/ -B./core/build/emscripten -DCMAKE_BUILD_TYPE=Release
                '''
                sh '''#!/bin/bash
                    source /opt/env.sh
                    emmake make -C./core/build/emscripten -j$(nproc)
                '''
                archiveArtifacts artifacts: 'README.md', fingerprint: true
            }
        }

        stage ('App/Build') {
            steps {
                dir('./app') {
                    sh 'npm ci --cache ${NPM_CACHE}'
//                  sh 'npm run build'
                    sh 'echo "build all the things"'
                }
            }
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
