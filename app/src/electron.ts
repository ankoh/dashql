import { app, BrowserWindow, MessageChannelMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 750,
        webPreferences: {
            nodeIntegration: true,
            preload: path.join(__dirname, 'app', 'preload.cjs'),
        },
        show: false,
        autoHideMenuBar: true,
    });
    win.loadFile('./app/index.html');
    win.once('ready-to-show', () => {
        win.show();
    });
}

app.on('ready', createWindow);
