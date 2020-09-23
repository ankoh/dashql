pipeline {
    agent {
        docker { image 'dashql/dashql-dev:1.40.1' }
    }
    stages {
        stage('Protobuf') {
            steps {
                sh 'git submodule update --init --recursive'
                sh 'JENKINS_BUILD=1 ./dev/compile_wasm.sh'
            }
        }
    }
}
