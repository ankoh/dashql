import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const buildDir = path.join(__dirname, 'build', 'app-release');

app.use(express.static(buildDir));
app.get('/*', (req, res) => {
    res.sendFile(path.join(buildDir, 'index.html'));
});

console.log('Serving at port 9010');
app.listen(9010);
