pipeline {
    agent {
        dockerfile {
            filename 'Dockerfile'
            dir './dev/'
            additionalBuildArgs '--build-arg EMSDK_VERSION=2.0.4 --build-arg NODE_VERSION=v14.13.0'
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
                sh 'mkdir -p ./libs/cpp/build/emscripten ./reports'
                sh './dev/reset_duckdb.sh'
            }
        }

        stage('CPP/Build') {
            steps {
                sh 'cmake -S./libs/cpp/ -B./libs/cpp/build/debug -DCMAKE_BUILD_TYPE=Debug -DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_BUILD_TYPE=Debug'
                sh 'ccache -s'
                sh 'make -C./libs/cpp/build/debug -j$(nproc)'
                sh 'ccache -s'
            }
        }

        stage('CPP/Test') {
            steps {
                sh './libs/cpp/build/debug/tester --gtest_output=xml:./reports/tests_cpp.xml'
            }
        }


        stage('WASM/Build') {
            steps {
                sh '''#!/bin/bash
                    source /opt/env.sh
                    emcmake cmake -S./libs/cpp/ -B./libs/cpp/build/emscripten -DCMAKE_BUILD_TYPE=Release
                '''
                sh '''#!/bin/bash
                    source /opt/env.sh
                    emmake make -C./libs/cpp/build/emscripten -j$(nproc) duckdb_webapi duckdb_nodeapi
                    cp ./libs/cpp/build/emscripten/duckdb_webapi.{wasm,js,worker.js} ./libs/js/src/duckdb/
                    cp ./libs/cpp/build/emscripten/duckdb_nodeapi.{wasm,js,worker.js} ./libs/js/src/duckdb/
                '''
            }
        }

        stage ('JS/Build') {
            steps {
                dir('./libs/js') {
                    sh '''#!/bin/bash
                        source /opt/env.sh
                        nvm use default
                        npm ci --cache ${NPM_CACHE}
                        npm run build
                    '''
                }
            }
        }

        stage ('JS/Test') {
            steps {
                dir('./libs/js') {
                    sh '''#!/bin/bash
                        source /opt/env.sh
                        nvm use default
                        npm run test:ci
                    '''
                }
            }
        }
    }

    post {
        always {
            script {
                env.GIT_COMMIT_MSG = sh (script: 'git log -1 --pretty=%B ${GIT_COMMIT}', returnStdout: true).trim()
            }
            junit 'reports/tests_*.xml'
            discordSend description: env.GIT_COMMIT_MSG, link: env.RUN_DISPLAY_URL, result: currentBuild.currentResult, title: JOB_NAME, webhookURL: "https://discordapp.com/api/webhooks/759701192439365652/XK_i40yR6eaX8xhama49DpZvZ8yJZi1BKXrbgeQN176zVbWjCkQERfVt7qAjj88A1PNK"
        }
    }
}
