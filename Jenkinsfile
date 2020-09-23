pipeline {
    agent {
        docker { image 'dashql/dashql-dev:1.40.1' }
    }
    stages {
        stage('Protocol Buffers') {
            steps {
                sh './dev/build_protoc.sh'
                sh './dev/generate_proto.sh'
            }
        }
    }
}
