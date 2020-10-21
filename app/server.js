const express = require('express');
const path = require('path');
const app = express();
const buildDir = path.join(__dirname, 'build', 'release');

app.use(express.static(buildDir));
app.get('/*', function(req, res) {
    res.sendFile(path.join(buildDir, 'index.html'));
});

console.log("Serving at port 9000");
app.listen(9000);
