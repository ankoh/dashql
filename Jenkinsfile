pipeline {
    agent {
        dockerfile {
            filename 'Dockerfile'
            dir './scripts/'
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
                sh 'mkdir -p ./core/cpp/build/emscripten ./reports'
                sh './scripts/reset_duckdb.sh'
            }
        }

        stage('Native/Build') {
            steps {
                sh 'cmake -S./core/cpp/ -B./core/cpp/build/debug -DCMAKE_BUILD_TYPE=Debug -DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_BUILD_TYPE=Debug'
                sh 'ccache -s'
                sh 'make -C./core/cpp/build/debug -j$(nproc)'
                sh 'ccache -s'
            }
        }

        stage('Native/Test') {
            parallel {
                stage('Grammar') {
                    steps {
                        sh './core/cpp/build/debug/grammar_tests ./core/cpp/test/grammar --gtest_output=xml:./reports/tests_native_grammar.xml'
                    }
                }

                stage('DuckDB') {
                    steps {
                        sh './core/cpp/build/debug/duckdb/duckdb_tester --gtest_output=xml:./reports/tests_native_duckdb.xml'
                    }
                }
            }
        }


        stage('Wasm/Build') {
            steps {
                sh '''#!/bin/bash
                    source /opt/env.sh
                    emcmake cmake -S./core/cpp/ -B./core/cpp/build/emscripten -DCMAKE_BUILD_TYPE=Release
                '''
                sh '''#!/bin/bash
                    source /opt/env.sh
                    emmake make -C./core/cpp/build/emscripten -j$(nproc) dashql_core_web dashql_core_node duckdb_web duckdb_node
                    cp ./core/cpp/build/emscripten/dashql_core_web.{wasm,js} ./core/js/src/wasm/
                    cp ./core/cpp/build/emscripten/dashql_core_node.{wasm,js} ./core/js/src/wasm/
                    cp ./core/cpp/build/emscripten/duckdb/duckdb_web.{wasm,js,worker.js} ./duckdb/js/src/wasm/
                    cp ./core/cpp/build/emscripten/duckdb/duckdb_node.{wasm,js,worker.js} ./duckdb/js/src/wasm/
                '''
            }
        }

        stage ('JS/Test') {
            parallel {
                stage('Core') {
                    stages {
                        stage ('Build') {
                            steps {
                                dir('./core/js') {
                                    sh '''#!/bin/bash
                                        source /opt/env.sh
                                        nvm use default
                                        npm ci --cache ${NPM_CACHE}
                                        npm run build
                                    '''
                                }
                            }
                        }

                        stage ('Test') {
                            steps {
                                dir('./core/js') {
                                    sh '''#!/bin/bash
                                        source /opt/env.sh
                                        nvm use default
                                        npm run test:ci
                                    '''
                                }
                            }
                        }
                    }
                }

                stage('DuckDB') {
                    stages {
                        stage ('Build') {
                            steps {
                                dir('./duckdb/js') {
                                    sh '''#!/bin/bash
                                        source /opt/env.sh
                                        nvm use default
                                        npm ci --cache ${NPM_CACHE}
                                        npm run build
                                    '''
                                }
                            }
                        }

                        stage ('Test') {
                            steps {
                                dir('./duckdb/js') {
                                    sh '''#!/bin/bash
                                        source /opt/env.sh
                                        nvm use default
                                        npm run test:ci
                                    '''
                                }
                            }
                        }
                    }
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

