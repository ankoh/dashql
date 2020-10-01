pipeline {
    agent {
        dockerfile {
            filename 'Dockerfile.emsdk'
            dir './dev/'
            additionalBuildArgs '--build-arg EMSDK_VERSION=2.0.4'
            args '-v $HOME/.emscripten_cache:/mnt/emscripten_cache -v $HOME/.npm_cache:/mnt/npm_cache -v $HOME/.ccache:/mnt/ccache'
        }
    }

    environment {
        EM_CACHE = '/mnt/emscripten_cache'
        NPM_CACHE = '/mnt/npm_cache'
        CCACHE_DIR = '/mnt/ccache'
        CCACHE_BASEDIR = '${WORKSPACE}'
    }

    stages {
        stage('Configure') {
            steps {
                sh 'chown -R "$USER" /mnt/npm_cache /mnt/emscripten_cache'
                sh 'git submodule update --init --recursive'
                sh 'mkdir -p ./webapi/build/emscripten'
            }
        }

        stage('Native/Build') {
            steps {
                sh 'cmake -S./webapi/ -B./webapi/build/debug -DCMAKE_BUILD_TYPE=Debug -DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_BUILD_TYPE=Debug'
                sh 'ccache -s'
                sh 'make -C./webapi/build/debug -j$(nproc)'
                sh 'ccache -s'
            }
        }

        stage('Native/Test') {
            steps {
                sh './webapi/build/debug/tester'
            }
        }


        stage('Web/Build') {
            steps {
                sh '''#!/bin/bash
                    source /opt/env.sh
                    emcmake cmake -S./webapi/ -B./webapi/build/emscripten -DCMAKE_BUILD_TYPE=Release
                '''
                sh '''#!/bin/bash
                    source /opt/env.sh
                    emmake make -C./webapi/build/emscripten -j$(nproc) duckdb_webapi duckdb_nodeapi
                    cp ./webapi/build/emscripten/duckdb_webapi.{wasm,js,worker.js} ./jslib/src/duckdb/
                    cp ./webapi/build/emscripten/duckdb_nodeapi.{wasm,js,worker.js} ./jslib/src/duckdb/
                '''
            }
        }

        stage ('Web/Pack') {
            steps {
                dir('./jslib') {
                    sh 'npm ci --cache ${NPM_CACHE}'
                    sh 'npm run build'
                }
            }
        }

        stage ('Web/Test') {
            steps {
                dir('./jslib') {
                    sh 'npm run test'
                }
            }
        }
    }

    post {
        always {
            script {
                env.GIT_COMMIT_MSG = sh (script: 'git log -1 --pretty=%B ${GIT_COMMIT}', returnStdout: true).trim()
            }
            discordSend description: env.GIT_COMMIT_MSG, link: env.RUN_DISPLAY_URL, result: currentBuild.currentResult, title: JOB_NAME, webhookURL: "https://discordapp.com/api/webhooks/759701192439365652/XK_i40yR6eaX8xhama49DpZvZ8yJZi1BKXrbgeQN176zVbWjCkQERfVt7qAjj88A1PNK"
        }
    }
}
