#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."

DATE=date
if [[ "$OSTYPE" == "darwin"* ]]; then
    DATE=gdate
    echo "We use gdate on macOS. Install it with: brew install coreutils"
fi
${DATE} --version 1>/dev/null \
    && { echo "[ OK   ] Command: ${DATE}"; } \
    || { echo "[ ERR  ] Command: ${DATE}"; exit 1; }

aws s3 ls --recursive "$1" | while read -r LINE;
    do
        FILE_TIMESTAMP=$(echo $LINE|awk {'print $1" "$2'})
        FILE_TIMESTAMP=$(${DATE} -d"$FILE_TIMESTAMP" "+%s")
        OLDER_THAN=$(${DATE} -d "$2 ago" "+%s")
        if [[ $FILE_TIMESTAMP -le $OLDER_THAN ]];
            then
            FILE_NAME=`echo $LINE|awk {'print $4'}`
            if [ $FILE_NAME != "" ]; then
                aws s3 rm "$1/$FILE_NAME"
            fi
        fi
    done;
